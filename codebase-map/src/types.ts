export type EdgeType = "import" | "include";

export interface GraphNode {
  id: string;
  path: string;
  dir: string;
  ext: string;
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
