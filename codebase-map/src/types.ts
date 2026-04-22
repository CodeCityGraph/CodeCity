export type EdgeType = "import" | "dynamic-import";
export type NodeCategory = "source" | "external";
export type DependencyScope = "internal" | "external";

export interface GraphNode {
  id: string;
  path: string;
  dir: string;
  ext: string;
  category: NodeCategory;
  sizeBytes: number;
  loc: number;
  inDegree: number;
  outDegree: number;
  riskScore: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  scope: DependencyScope;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolvedImports: string[];
}

export interface AnalyzerConfig {
  ignoredDirs: string[];
  allowExtensions: string[];
  riskWeights: {
    inDegree: number;
    outDegree: number;
    size: number;
  };
}
