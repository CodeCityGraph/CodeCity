import JSZip from "jszip";
import type { AnalyzerConfig, EdgeType, GraphData, GraphEdge, GraphNode } from "./types";

const defaultConfig: AnalyzerConfig = {
  ignoredDirs: ["node_modules", "dist", "out", ".git", ".output"],
  allowExtensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"],
  riskWeights: {
    inDegree: 1,
    outDegree: 1,
    size: 0.5
  }
};

interface SourceFile {
  path: string;
  content: string;
  sizeBytes: number;
}

interface ImportSpecifier {
  specifier: string;
  edgeType: EdgeType;
}

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
  if (parts.some(part => config.ignoredDirs.includes(part))) return false;
  return config.allowExtensions.includes(getExt(normalized));
}

function lineCount(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
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
        edgeType: "import"
      });
    }
  }

  let dynamicMatch: RegExpExecArray | null;
  while ((dynamicMatch = dynamicImportRe.exec(content)) !== null) {
    specifiers.push({
      specifier: dynamicMatch[1],
      edgeType: "dynamic-import"
    });
  }

  return specifiers;
}

function getExternalPackageName(specifier: string): string {
  const trimmed = specifier.trim().replace(/^node:/, "");
  const parts = trimmed.split("/");
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

function createSourceNode(path: string, content: string, sizeBytes: number): GraphNode {
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

    const specifiers = extractJSImportSpecifiers(file.content);
    for (const { specifier, edgeType } of specifiers) {
      if (specifier.startsWith(".")) {
        const resolved = resolveRelativeImport(source, specifier, fileSet);
        if (!resolved) {
          unresolvedImports.add(`${source} -> ${specifier}`);
          continue;
        }
        addUniqueEdge(edgeSet, edges, source, resolved, edgeType, "internal");
        continue;
      }

      const packageName = getExternalPackageName(specifier);
      const target = upsertExternalNode(nodeMap, packageName);
      addUniqueEdge(edgeSet, edges, source, target, edgeType, "external");
    }
  }

  return { edges, unresolvedImports: Array.from(unresolvedImports) };
}

function resolveRelativeImport(sourcePath: string, specifier: string, fileSet: Set<string>): string | null {
  if (!specifier.startsWith(".")) return null;

  const sourceDir = getDir(sourcePath);
  const baseParts = sourceDir === "(root)" ? [] : sourceDir.split("/");
  const specParts = specifier.split("/");
  const resolvedParts = [...baseParts];

  for (const part of specParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }

  const base = normalizePath(resolvedParts.join("/"));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/index.mjs`,
    `${base}/index.cjs`
  ];

  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
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

async function createGraphFromZipSource(zipSource: File | ArrayBuffer): Promise<GraphData> {
  const zip = await JSZip.loadAsync(zipSource);
  const files: SourceFile[] = [];

  const entries = Object.entries(zip.files);
  for (const [path, entry] of entries) {
    if (entry.dir) continue;
    if (!shouldIncludePath(path, defaultConfig)) continue;

    const content = await entry.async("string");
    files.push({
      path,
      content,
      sizeBytes: new TextEncoder().encode(content).length
    });
  }

  return createGraphFromFiles(files);
}

export async function createGraphFromZip(zipFile: File): Promise<GraphData> {
  return createGraphFromZipSource(zipFile);
}

export async function createGraphFromZipBuffer(zipBuffer: ArrayBuffer): Promise<GraphData> {
  return createGraphFromZipSource(zipBuffer);
}
