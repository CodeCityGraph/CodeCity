import type { GraphNode, GraphEdge } from "./types";
import { detectDependencyCommunities } from "./communityDetection";

export type ClusteringMode = "directory" | "community";

interface Point {
  x: number;
  y: number;
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function jitter(seed: string, radius: number): Point {
  const h = hash(seed);
  const angle = (h % 360) * (Math.PI / 180);
  const dist = (h % 1000) / 1000 * radius;
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist
  };
}

export function getDirectoryClusterPositions(nodes: GraphNode[]): Record<string, Point> {
  const dirs = Array.from(new Set(nodes.map(node => node.dir))).sort();
  const cols = Math.max(1, Math.ceil(Math.sqrt(dirs.length)));
  const spacing = 410;
  const centers = new Map<string, Point>();

  dirs.forEach((dir, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    centers.set(dir, {
      x: (col - (cols - 1) / 2) * spacing,
      y: row * spacing
    });
  });

  const byDir = new Map<string, GraphNode[]>();
  nodes.forEach(node => {
    const existing = byDir.get(node.dir) ?? [];
    existing.push(node);
    byDir.set(node.dir, existing);
  });

  const positions: Record<string, Point> = {};
  for (const [dir, group] of byDir.entries()) {
    const center = centers.get(dir) ?? { x: 0, y: 0 };
    const radius = 38 + Math.sqrt(group.length) * 28;
    group.forEach(node => {
      const local = jitter(`${dir}/${node.id}`, radius);
      positions[node.id] = {
        x: center.x + local.x,
        y: center.y + local.y
      };
    });
  }

  return positions;
}

/**
 * Generate positions for nodes based on dependency communities
 */
export function getCommunityClusterPositions(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Record<string, Point> {
  const sourceNodes = nodes.filter(n => n.category === "source");
  
  if (sourceNodes.length === 0) {
    return {};
  }

  // Detect communities
  const detection = detectDependencyCommunities(nodes, edges);
  const communities = detection.communities;

  if (communities.length === 0) {
    return getDirectoryClusterPositions(nodes);
  }

  // Position communities in a grid layout
  const cols = Math.max(1, Math.ceil(Math.sqrt(communities.length)));
  const spacing = 450;
  const centers = new Map<string, Point>();

  communities.forEach((community, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    centers.set(community.id, {
      x: (col - (cols - 1) / 2) * spacing,
      y: row * spacing
    });
  });

  // Group nodes by community
  const byCommunity = new Map<string, GraphNode[]>();
  sourceNodes.forEach(node => {
    const communityId = detection.nodeToCluster.get(node.id) ?? "unknown";
    const existing = byCommunity.get(communityId) ?? [];
    existing.push(node);
    byCommunity.set(communityId, existing);
  });

  // Position nodes within communities with spiral layout
  const positions: Record<string, Point> = {};
  
  for (const [communityId, group] of byCommunity.entries()) {
    const center = centers.get(communityId) ?? { x: 0, y: 0 };
    const radius = 40 + Math.sqrt(group.length) * 30;

    group.forEach((node, idx) => {
      const anglePerNode = (Math.PI * 2) / Math.max(1, group.length);
      const angle = anglePerNode * idx;
      const distance = radius * (0.3 + 0.7 * (idx / Math.max(1, group.length - 1)));

      const local = {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance
      };

      // Add some jitter for visual variety
      const jitterAmount = jitter(`${communityId}/${node.id}`, radius * 0.15);
      positions[node.id] = {
        x: center.x + local.x + jitterAmount.x,
        y: center.y + local.y + jitterAmount.y
      };
    });
  }

  // Position external nodes around the layout
  const externalNodes = nodes.filter(n => n.category === "external");
  const externalRadius = spacing * (cols + 1) * 0.4;
  
  externalNodes.forEach((node, idx) => {
    const angle = (Math.PI * 2 * idx) / Math.max(1, externalNodes.length);
    positions[node.id] = {
      x: Math.cos(angle) * externalRadius,
      y: Math.sin(angle) * externalRadius
    };
  });

  return positions;
}

/**
 * Get cluster mapping for a given mode
 */
export function getClusterMapping(
  nodes: GraphNode[],
  edges: GraphEdge[],
  mode: ClusteringMode
): Map<string, string> {
  const mapping = new Map<string, string>();

  if (mode === "directory") {
    nodes.forEach(node => {
      mapping.set(node.id, node.dir);
    });
  } else if (mode === "community") {
    const detection = detectDependencyCommunities(nodes, edges);
    detection.nodeToCluster.forEach((cluster, nodeId) => {
      mapping.set(nodeId, cluster);
    });
  }

  return mapping;
}
