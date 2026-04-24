import JSZip from "jszip";
import type { AnalyzerConfig, EdgeType, GraphData, GraphEdge, GraphNode } from "./types";

const defaultConfig: AnalyzerConfig = {
  ignoredDirs: ["node_modules", "dist", "out", ".git", ".output"],
  riskWeights: {
    inDegree: 1,
    outDegree: 1,
    size: 0.5
  }
};

interface SourceFile {
  path: string;
  content: string | null;
  sizeBytes: number;
}

interface ImportSpecifier {
  specifier: string;
  edgeType: EdgeType;
  pathLike: boolean;
}

export interface AnalysisProgress {
  stage: "loading" | "reading-files" | "building-graph" | "done";
  processedFiles: number;
  totalFiles: number;
  currentPath?: string;
}

type ProgressCallback = (progress: AnalysisProgress) => void;

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".java", ".kt", ".kts", ".scala",
  ".c", ".h", ".hpp", ".hh", ".hxx", ".cpp", ".cc", ".cxx",
  ".cs", ".go", ".rs", ".php", ".rb", ".swift", ".lua", ".r",
  ".html", ".htm", ".xhtml", ".css", ".scss", ".sass", ".less",
  ".xml", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties", ".md", ".txt", ".sh"
]);

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function getExt(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function getDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "(root)" : path.slice(0, slash);
}

function shouldIncludePath(path: string, config: AnalyzerConfig): boolean {
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  return !parts.some(part => config.ignoredDirs.includes(part));
}

function isLikelyText(path: string): boolean {
  const ext = getExt(path);
  return TEXT_EXTENSIONS.has(ext);
}

function lineCount(content: string | null): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function isSkippableSpecifier(specifier: string): boolean {
  const trimmed = specifier.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:")
  );
}

function extractJSImportSpecifiers(content: string): ImportSpecifier[] {
  const importFrom = /import\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g;
  const importOnly = /import\s+["']([^"']+)["']/g;
  const requireRe = /require\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportRe = /import\(\s*["']([^"']+)["']\s*\)/g;

  const specifiers: ImportSpecifier[] = [];
  for (const regex of [importFrom, importOnly, requireRe]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      specifiers.push({
        specifier: match[1],
        edgeType: "import",
        pathLike: false
      });
    }
  }

  let dynamicMatch: RegExpExecArray | null;
  while ((dynamicMatch = dynamicImportRe.exec(content)) !== null) {
    specifiers.push({
      specifier: dynamicMatch[1],
      edgeType: "dynamic-import",
      pathLike: false
    });
  }

  return specifiers;
}

function extractPythonSpecifiers(content: string): ImportSpecifier[] {
  const imports: ImportSpecifier[] = [];
  const importRe = /^\s*import\s+([^\n#]+)/gm;
  const fromRe = /^\s*from\s+([^\s]+)\s+import\s+/gm;

  let match: RegExpExecArray | null;
  while ((match = importRe.exec(content)) !== null) {
    const modules = match[1].split(",").map(part => part.trim().split(" as ")[0].trim());
    modules.filter(Boolean).forEach(moduleName => {
      imports.push({ specifier: moduleName.replace(/\./g, "/"), edgeType: "import", pathLike: false });
    });
  }

  while ((match = fromRe.exec(content)) !== null) {
    const moduleName = match[1].trim();
    if (!moduleName) continue;
    imports.push({
      specifier: moduleName.replace(/\./g, "/"),
      edgeType: "import",
      pathLike: moduleName.startsWith(".")
    });
  }

  return imports;
}

function extractCLikeIncludes(content: string): ImportSpecifier[] {
  const includeRe = /^\s*#include\s*[<"]([^">]+)[">]/gm;
  const imports: ImportSpecifier[] = [];
  let match: RegExpExecArray | null;
  while ((match = includeRe.exec(content)) !== null) {
    imports.push({
      specifier: match[1].trim(),
      edgeType: "import",
      pathLike: true
    });
  }
  return imports;
}

function extractJavaLikeImports(content: string): ImportSpecifier[] {
  const importRe = /^\s*import\s+(?:static\s+)?([^;\s]+)\s*;/gm;
  const imports: ImportSpecifier[] = [];
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(content)) !== null) {
    imports.push({
      specifier: match[1].replace(/\./g, "/"),
      edgeType: "import",
      pathLike: false
    });
  }
  return imports;
}

function extractCSharpImports(content: string): ImportSpecifier[] {
  const usingRe = /^\s*using\s+([^;\s=]+)\s*;/gm;
  const imports: ImportSpecifier[] = [];
  let match: RegExpExecArray | null;
  while ((match = usingRe.exec(content)) !== null) {
    imports.push({
      specifier: match[1].replace(/\./g, "/"),
      edgeType: "import",
      pathLike: false
    });
  }
  return imports;
}

function extractGoImports(content: string): ImportSpecifier[] {
  const imports: ImportSpecifier[] = [];
  const single = /\bimport\s+"([^"]+)"/g;
  const grouped = /\bimport\s*\(([^)]*)\)/gs;

  let match: RegExpExecArray | null;
  while ((match = single.exec(content)) !== null) {
    imports.push({ specifier: match[1], edgeType: "import", pathLike: false });
  }

  while ((match = grouped.exec(content)) !== null) {
    const body = match[1];
    const strRe = /"([^"]+)"/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = strRe.exec(body)) !== null) {
      imports.push({ specifier: strMatch[1], edgeType: "import", pathLike: false });
    }
  }

  return imports;
}

function extractRustImports(content: string): ImportSpecifier[] {
  const useRe = /^\s*use\s+([^;]+);/gm;
  const imports: ImportSpecifier[] = [];
  let match: RegExpExecArray | null;
  while ((match = useRe.exec(content)) !== null) {
    const token = match[1].split("::")[0].trim();
    if (!token) continue;
    imports.push({
      specifier: token,
      edgeType: "import",
      pathLike: token === "crate" || token === "super" || token === "self"
    });
  }
  return imports;
}

function extractPhpImports(content: string): ImportSpecifier[] {
  const includeRe = /\b(?:require|require_once|include|include_once)\s*\(?\s*["']([^"']+)["']/g;
  const useRe = /^\s*use\s+([^;\s]+)\s*;/gm;
  const imports: ImportSpecifier[] = [];

  let match: RegExpExecArray | null;
  while ((match = includeRe.exec(content)) !== null) {
    imports.push({ specifier: match[1], edgeType: "import", pathLike: true });
  }
  while ((match = useRe.exec(content)) !== null) {
    imports.push({ specifier: match[1].replace(/\\/g, "/"), edgeType: "import", pathLike: false });
  }

  return imports;
}

function extractRubyImports(content: string): ImportSpecifier[] {
  const requireRe = /^\s*require(?:_relative)?\s+["']([^"']+)["']/gm;
  const imports: ImportSpecifier[] = [];
  let match: RegExpExecArray | null;
  while ((match = requireRe.exec(content)) !== null) {
    const spec = match[1];
    imports.push({
      specifier: spec,
      edgeType: "import",
      pathLike: spec.startsWith(".") || spec.includes("/")
    });
  }
  return imports;
}

function extractHtmlSpecifiers(content: string): ImportSpecifier[] {
  const imports: ImportSpecifier[] = [];
  const attrRe = /<(?:script|link|img|source|video|audio|a|iframe|embed|object|track)\b[^>]*\b(?:src|href|data)=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(content)) !== null) {
    imports.push({ specifier: match[1], edgeType: "import", pathLike: true });
  }
  return imports;
}

function extractCssSpecifiers(content: string): ImportSpecifier[] {
  const imports: ImportSpecifier[] = [];
  const importRe = /@import\s+(?:url\()?\s*["']?([^"')\s]+)["']?\s*\)?/gi;
  const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let match: RegExpExecArray | null;

  while ((match = importRe.exec(content)) !== null) {
    imports.push({ specifier: match[1], edgeType: "import", pathLike: true });
  }
  while ((match = urlRe.exec(content)) !== null) {
    imports.push({ specifier: match[1], edgeType: "import", pathLike: true });
  }

  return imports;
}

function extractSpecifiersByExtension(path: string, content: string): ImportSpecifier[] {
  const ext = getExt(path);
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) return extractJSImportSpecifiers(content);
  if (ext === ".py") return extractPythonSpecifiers(content);
  if ([".c", ".h", ".hpp", ".hh", ".hxx", ".cpp", ".cc", ".cxx"].includes(ext)) return extractCLikeIncludes(content);
  if ([".java", ".kt", ".kts", ".scala"].includes(ext)) return extractJavaLikeImports(content);
  if (ext === ".cs") return extractCSharpImports(content);
  if (ext === ".go") return extractGoImports(content);
  if (ext === ".rs") return extractRustImports(content);
  if (ext === ".php") return extractPhpImports(content);
  if (ext === ".rb") return extractRubyImports(content);
  if ([".html", ".htm", ".xhtml"].includes(ext)) return extractHtmlSpecifiers(content);
  if ([".css", ".scss", ".sass", ".less"].includes(ext)) return extractCssSpecifiers(content);
  return [];
}

function getExternalPackageName(specifier: string): string {
  const trimmed = specifier.trim().replace(/^node:/, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (trimmed.startsWith("@") && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] || trimmed;
}

function upsertExternalNode(nodeMap: Map<string, GraphNode>, packageName: string): string {
  const nodeId = `external:${packageName}`;
  if (!nodeMap.has(nodeId)) {
    nodeMap.set(nodeId, {
      id: nodeId,
      path: packageName,
      dir: "(external)",
      ext: "",
      category: "external",
      sizeBytes: 0,
      loc: 0,
      inDegree: 0,
      outDegree: 0,
      riskScore: 0
    });
  }
  return nodeId;
}

function addUniqueEdge(
  edgeSet: Set<string>,
  edges: GraphEdge[],
  source: string,
  target: string,
  type: EdgeType,
  scope: "internal" | "external"
): void {
  const key = `${source}::${target}::${type}::${scope}`;
  if (edgeSet.has(key)) return;
  edgeSet.add(key);
  edges.push({
    source,
    target,
    type,
    scope
  });
}

function createSourceNode(path: string, content: string | null, sizeBytes: number): GraphNode {
  return {
    id: path,
    path,
    dir: getDir(path),
    ext: getExt(path),
    category: "source",
    sizeBytes,
    loc: lineCount(content),
    inDegree: 0,
    outDegree: 0,
    riskScore: 0
  };
}

function collectIncludedSourceFiles(files: SourceFile[], config: AnalyzerConfig): SourceFile[] {
  return files.filter(file => shouldIncludePath(file.path, config));
}

function createSourceNodeMap(files: SourceFile[]): Map<string, GraphNode> {
  const nodeMap = new Map<string, GraphNode>();
  for (const file of files) {
    const path = normalizePath(file.path);
    if (nodeMap.has(path)) continue;
    nodeMap.set(path, createSourceNode(path, file.content, file.sizeBytes));
  }
  return nodeMap;
}

function resolvePathCandidate(pathValue: string, fileSet: Set<string>): string | null {
  const normalized = normalizePath(pathValue);
  if (!normalized) return null;

  const withoutQuery = normalized.split(/[?#]/, 1)[0];
  const base = withoutQuery.replace(/\/+$/, "");
  if (!base) return null;

  const extensionSet = new Set<string>();
  fileSet.forEach(file => extensionSet.add(getExt(file)));
  extensionSet.delete("");

  const candidates = new Set<string>([
    base,
    `${base}/index`,
    `${base}.d`
  ]);

  extensionSet.forEach(ext => {
    candidates.add(`${base}${ext}`);
    candidates.add(`${base}/index${ext}`);
    candidates.add(`${base}.d${ext}`);
  });

  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function resolveRelativeReference(
  sourcePath: string,
  specifier: string,
  fileSet: Set<string>,
  pathLike: boolean
): string | null {
  const trimmed = specifier.trim();
  if (!trimmed || isSkippableSpecifier(trimmed)) return null;

  const sourceDir = getDir(sourcePath);
  const baseParts = sourceDir === "(root)" ? [] : sourceDir.split("/");

  if (trimmed.startsWith("/")) {
    const absolutePath = trimmed.replace(/^\/+/, "");
    return resolvePathCandidate(absolutePath, fileSet);
  }

  const shouldTreatAsRelative =
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    pathLike;

  if (!shouldTreatAsRelative) return null;

  const specParts = trimmed.split("/");
  const resolvedParts = [...baseParts];

  for (const part of specParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }

  return resolvePathCandidate(resolvedParts.join("/"), fileSet);
}

function createEdges(
  sourceFiles: SourceFile[],
  nodeMap: Map<string, GraphNode>
): { edges: GraphEdge[]; unresolvedImports: string[] } {
  const fileSet = new Set(nodeMap.keys());
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];
  const unresolvedImports = new Set<string>();

  for (const file of sourceFiles) {
    const source = normalizePath(file.path);
    if (!nodeMap.has(source)) continue;
    if (!file.content) continue;

    const specifiers = extractSpecifiersByExtension(source, file.content);
    for (const { specifier, edgeType, pathLike } of specifiers) {
      const resolved = resolveRelativeReference(source, specifier, fileSet, pathLike);
      if (resolved) {
        addUniqueEdge(edgeSet, edges, source, resolved, edgeType, "internal");
        continue;
      }

      if (!pathLike && !isSkippableSpecifier(specifier) && !specifier.startsWith(".") && !specifier.startsWith("/")) {
        const packageName = getExternalPackageName(specifier);
        const target = upsertExternalNode(nodeMap, packageName);
        addUniqueEdge(edgeSet, edges, source, target, edgeType, "external");
        continue;
      }

      unresolvedImports.add(`${source} -> ${specifier}`);
    }
  }

  return { edges, unresolvedImports: Array.from(unresolvedImports) };
}

function computeRisk(node: GraphNode, weights: AnalyzerConfig["riskWeights"]): number {
  const sizeTerm = node.sizeBytes > 0 ? Math.log(node.sizeBytes) : 0;
  return (
    weights.inDegree * node.inDegree +
    weights.outDegree * node.outDegree +
    weights.size * sizeTerm
  );
}

export function createGraphFromFiles(files: SourceFile[], partialConfig: Partial<AnalyzerConfig> = {}): GraphData {
  const config: AnalyzerConfig = {
    ...defaultConfig,
    ...partialConfig,
    riskWeights: {
      ...defaultConfig.riskWeights,
      ...partialConfig.riskWeights
    }
  };

  const sourceFiles = collectIncludedSourceFiles(files, config);
  const nodeMap = createSourceNodeMap(sourceFiles);
  const { edges, unresolvedImports } = createEdges(sourceFiles, nodeMap);

  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (sourceNode) sourceNode.outDegree += 1;
    if (targetNode) targetNode.inDegree += 1;
  }

  const nodes = Array.from(nodeMap.values()).map(node => ({
    ...node,
    riskScore: Number(computeRisk(node, config.riskWeights).toFixed(3))
  }));

  return { nodes, edges, unresolvedImports };
}

async function createGraphFromZipSource(zipSource: File | ArrayBuffer, onProgress?: ProgressCallback): Promise<GraphData> {
  const zip = await JSZip.loadAsync(zipSource);
  const files: SourceFile[] = [];

  const entries = Object.entries(zip.files);
  const entryCount = entries.filter(([, entry]) => !entry.dir).length;
  let processedFiles = 0;

  onProgress?.({ stage: "loading", processedFiles: 0, totalFiles: entryCount });

  for (const [path, entry] of entries) {
    if (entry.dir) continue;
    if (!shouldIncludePath(path, defaultConfig)) continue;

    const bytes = await entry.async("uint8array");
    const sizeBytes = bytes.byteLength;
    let content: string | null = null;

    if (isLikelyText(path)) {
      content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }

    files.push({
      path,
      content,
      sizeBytes
    });

    processedFiles += 1;
    if (processedFiles === 1 || processedFiles % 50 === 0 || processedFiles === entryCount) {
      onProgress?.({
        stage: "reading-files",
        processedFiles,
        totalFiles: entryCount,
        currentPath: path
      });
    }
  }

  onProgress?.({ stage: "building-graph", processedFiles, totalFiles: entryCount });

  const graph = createGraphFromFiles(files);
  onProgress?.({ stage: "done", processedFiles: entryCount, totalFiles: entryCount });
  return graph;
}

export async function createGraphFromZip(zipFile: File): Promise<GraphData> {
  return createGraphFromZipSource(zipFile);
}

export async function createGraphFromZipBuffer(zipBuffer: ArrayBuffer): Promise<GraphData> {
  return createGraphFromZipSource(zipBuffer);
}

export async function createGraphFromZipBufferWithProgress(
  zipBuffer: ArrayBuffer,
  onProgress?: ProgressCallback
): Promise<GraphData> {
  return createGraphFromZipSource(zipBuffer, onProgress);
}
