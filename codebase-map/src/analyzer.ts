import JSZip from "jszip";
import type { AnalyzerConfig, GraphData, GraphEdge, GraphNode } from "./types";

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

function extractJSImportSpecifiers(content: string): string[] {
  const importFrom = /import\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g;
  const importOnly = /import\s+["']([^"']+)["']/g;
  const requireRe = /require\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportRe = /import\(\s*["']([^"']+)["']\s*\)/g;

  const specifiers: string[] = [];
  for (const regex of [importFrom, importOnly, requireRe, dynamicImportRe]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
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

  const included = files.filter(file => shouldIncludePath(file.path, config));
  const nodeMap = new Map<string, GraphNode>();
  for (const file of included) {
    const path = normalizePath(file.path);
    if (nodeMap.has(path)) continue;

    nodeMap.set(path, {
      id: path,
      path,
      dir: getDir(path),
      ext: getExt(path),
      sizeBytes: file.sizeBytes,
      loc: lineCount(file.content),
      inDegree: 0,
      outDegree: 0,
      riskScore: 0
    });
  }

  const fileSet = new Set(nodeMap.keys());
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];
  const unresolvedImports: string[] = [];

  for (const file of included) {
    const source = normalizePath(file.path);
    if (!nodeMap.has(source)) continue;

    const specifiers = extractJSImportSpecifiers(file.content);
    for (const specifier of specifiers) {
      const resolved = resolveRelativeImport(source, specifier, fileSet);
      if (!resolved) {
        unresolvedImports.push(`${source} -> ${specifier}`);
        continue;
      }

      const key = `${source}::${resolved}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push({
        source,
        target: resolved,
        type: "import"
      });
    }
  }

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

export async function createGraphFromZip(zipFile: File): Promise<GraphData> {
  const zip = await JSZip.loadAsync(zipFile);
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
