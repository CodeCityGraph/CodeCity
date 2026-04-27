/**
 * Community Detection Module
 * Detects dependency communities using graph-based clustering algorithms
 */

import type { GraphNode, GraphEdge } from "./types";

export interface Community {
  id: string;
  nodes: string[];
  density: number;
  internalEdges: number;
  externalEdges: number;
}

export interface CommunityDetectionResult {
  communities: Community[];
  modularity: number;
  nodeToCluster: Map<string, string>;
}

/**
 * Build adjacency representation for faster graph queries
 */
function buildAdjacencyMap(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  // Initialize all nodes
  nodes.forEach(node => {
    if (node.category === "source") {
      adjacency.set(node.id, new Set());
    }
  });

  // Add edges
  edges.forEach(edge => {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, new Set());
    }
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, new Set());
    }
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source); // Treat as undirected for clustering
  });

  return adjacency;
}

/**
 * Calculate modularity of a partition
 */
function calculateModularity(
  nodeToCluster: Map<string, string>,
  adjacency: Map<string, Set<string>>,
  totalEdges: number
): number {
  if (totalEdges === 0) return 0;

  let modularity = 0;
  const clusters = new Map<string, Set<string>>();

  // Group nodes by cluster
  nodeToCluster.forEach((cluster, node) => {
    if (!clusters.has(cluster)) {
      clusters.set(cluster, new Set());
    }
    clusters.get(cluster)?.add(node);
  });

  // Calculate modularity
  for (const [, nodes] of clusters) {
    let internalEdges = 0;
    let totalDegree = 0;

    const nodeArray = Array.from(nodes);
    for (let i = 0; i < nodeArray.length; i++) {
      const node1 = nodeArray[i];
      const neighbors = adjacency.get(node1) ?? new Set();
      totalDegree += neighbors.size;

      for (let j = i + 1; j < nodeArray.length; j++) {
        const node2 = nodeArray[j];
        if (neighbors.has(node2)) {
          internalEdges++;
        }
      }
    }

    const expectedEdges = (totalDegree * totalDegree) / (4 * totalEdges);
    modularity += (internalEdges - expectedEdges) / totalEdges;
  }

  return modularity;
}

/**
 * Louvain-inspired community detection algorithm
 * A greedy, fast algorithm for detecting community structure
 */
export function detectDependencyCommunities(
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxIterations: number = 10
): CommunityDetectionResult {
  const sourceNodes = nodes.filter(node => node.category === "source");
  const adjacency = buildAdjacencyMap(nodes, edges);
  
  // Initialize: each node is its own community
  const nodeToCluster = new Map<string, string>();
  const clusterIdMap = new Map<string, string>();
  let nextClusterId = 0;

  sourceNodes.forEach(node => {
    const clusterId = `c_${nextClusterId++}`;
    nodeToCluster.set(node.id, clusterId);
    clusterIdMap.set(clusterId, clusterId);
  });

  // Optimization phase: move nodes to neighboring clusters if it improves modularity
  let improved = true;
  let iteration = 0;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    for (const node of sourceNodes) {
      const nodeId = node.id;
      const currentCluster = nodeToCluster.get(nodeId)!;
      const neighbors = adjacency.get(nodeId) ?? new Set();
      
      // Find best cluster among neighbors
      let bestCluster = currentCluster;
      let bestModularity = calculateModularity(nodeToCluster, adjacency, edges.length);

      const neighborClusters = new Set<string>();
      neighbors.forEach(neighbor => {
        const cluster = nodeToCluster.get(neighbor);
        if (cluster) neighborClusters.add(cluster);
      });

      // Try moving to each neighbor's cluster
      for (const cluster of neighborClusters) {
        if (cluster === currentCluster) continue;

        // Temporarily move node
        nodeToCluster.set(nodeId, cluster);
        const testModularity = calculateModularity(nodeToCluster, adjacency, edges.length);

        if (testModularity > bestModularity) {
          bestModularity = testModularity;
          bestCluster = cluster;
        }

        // Move back
        nodeToCluster.set(nodeId, currentCluster);
      }

      // If better cluster found, move node
      if (bestCluster !== currentCluster) {
        nodeToCluster.set(nodeId, bestCluster);
        improved = true;
      }
    }
  }

  // Build communities
  const clusterMap = new Map<string, string[]>();
  const nodeToClusterFinal = new Map<string, string>();

  nodeToCluster.forEach((cluster, nodeId) => {
    if (!clusterMap.has(cluster)) {
      clusterMap.set(cluster, []);
    }
    clusterMap.get(cluster)?.push(nodeId);
  });

  // Relabel clusters for consistency
  let clusterIndex = 0;
  const clusterRelabel = new Map<string, string>();

  for (const [oldCluster, nodeIds] of clusterMap) {
    const newClusterId = `community_${clusterIndex++}`;
    clusterRelabel.set(oldCluster, newClusterId);
    nodeIds.forEach(nodeId => {
      nodeToClusterFinal.set(nodeId, newClusterId);
    });
  }

  // Create community objects
  const communities: Community[] = [];

  for (const [clusterId, nodeIds] of clusterMap) {
    const newClusterId = clusterRelabel.get(clusterId)!;
    let internalEdges = 0;
    let externalEdges = 0;

    edges.forEach(edge => {
      const sourceInCluster = nodeIds.includes(edge.source);
      const targetInCluster = nodeIds.includes(edge.target);

      if (sourceInCluster && targetInCluster) {
        internalEdges++;
      } else if (sourceInCluster || targetInCluster) {
        externalEdges++;
      }
    });

    const density = nodeIds.length > 1
      ? internalEdges / (nodeIds.length * (nodeIds.length - 1) / 2)
      : 0;

    communities.push({
      id: newClusterId,
      nodes: nodeIds,
      density,
      internalEdges,
      externalEdges
    });
  }

  // Sort communities by density
  communities.sort((a, b) => b.density - a.density);

  const finalModularity = calculateModularity(nodeToClusterFinal, adjacency, edges.length);

  return {
    communities,
    modularity: finalModularity,
    nodeToCluster: nodeToClusterFinal
  };
}

/**
 * Calculate graph metrics for a community
 */
export function analyzeCommunity(
  community: Community,
  nodes: GraphNode[]
): {
  averageRiskScore: number;
  avgInDegree: number;
  avgOutDegree: number;
} {
  const communityNodes = nodes.filter(n => community.nodes.includes(n.id));

  const avgRiskScore = communityNodes.length > 0
    ? communityNodes.reduce((sum, n) => sum + n.riskScore, 0) / communityNodes.length
    : 0;

  const avgInDegree = communityNodes.length > 0
    ? communityNodes.reduce((sum, n) => sum + n.inDegree, 0) / communityNodes.length
    : 0;

  const avgOutDegree = communityNodes.length > 0
    ? communityNodes.reduce((sum, n) => sum + n.outDegree, 0) / communityNodes.length
    : 0;

  return {
    averageRiskScore: avgRiskScore,
    avgInDegree,
    avgOutDegree
  };
}
