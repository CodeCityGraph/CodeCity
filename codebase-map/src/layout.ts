import type { GraphNode } from "./types";

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
