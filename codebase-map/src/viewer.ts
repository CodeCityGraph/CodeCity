import cytoscape, { type Core } from "cytoscape";
import { getDirectoryClusterPositions } from "./layout";
import type { GraphData } from "./types";

interface CreateViewerOptions {
  container?: HTMLElement;
  graph: GraphData;
  onNodeSelect?: (nodeId: string | null) => void;
  headless?: boolean;
}

interface Point {
  x: number;
  y: number;
}

function dirColor(dir: string): string {
  const palette = [
    "#5b3ad3",
    "#3b82f6",
    "#67e8f9",
    "#9a4dff",
    "#ff8bd1",
    "#6dd3ff",
    "#b4a6ff",
    "#7ee3c0",
    "#8fa2ff"
  ];
  let sum = 0;
  for (let i = 0; i < dir.length; i += 1) sum += dir.charCodeAt(i);
  return palette[sum % palette.length];
}

function scaleSize(value: number, min: number, max: number, outMin: number, outMax: number): number {
  if (max <= min) return (outMin + outMax) / 2;
  const t = (value - min) / (max - min);
  return outMin + t * (outMax - outMin);
}

function hashText(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededUnit(seed: string): number {
  return (hashText(seed) % 10000) / 10000;
}

function buildClusterStarElements(
  nodes: GraphData["nodes"],
  positions: Record<string, Point>
): Array<{ data: Record<string, string>; classes: string; position: Point; selectable: boolean; grabbable: boolean; pannable: boolean; locked: boolean }> {
  const starPalette = ["#ffffff", "#c7d2fe", "#a78bfa"];
  const byDir = new Map<string, GraphData["nodes"]>();

  nodes.forEach(node => {
    const group = byDir.get(node.dir) ?? [];
    group.push(node);
    byDir.set(node.dir, group);
  });

  const stars: Array<{
    data: Record<string, string>;
    classes: string;
    position: Point;
    selectable: boolean;
    grabbable: boolean;
    pannable: boolean;
    locked: boolean;
  }> = [];

  for (const [dir, group] of byDir.entries()) {
    if (group.length === 0) continue;

    let centerX = 0;
    let centerY = 0;
    group.forEach(node => {
      const pos = positions[node.id] ?? { x: 0, y: 0 };
      centerX += pos.x;
      centerY += pos.y;
    });
    centerX /= group.length;
    centerY /= group.length;

    let clusterRadius = 120;
    group.forEach(node => {
      const pos = positions[node.id] ?? { x: centerX, y: centerY };
      const dx = pos.x - centerX;
      const dy = pos.y - centerY;
      clusterRadius = Math.max(clusterRadius, Math.hypot(dx, dy));
    });

    const outerRadius = clusterRadius + 70;
    const starCount = 5 + (hashText(`count:${dir}`) % 11); // 5-15 stars per cluster.

    for (let i = 0; i < starCount; i += 1) {
      const seed = `${dir}:star:${i}`;
      const angle = seededUnit(`${seed}:angle`) * Math.PI * 2;
      const dist = (0.22 + seededUnit(`${seed}:dist`) * 0.46) * outerRadius;
      const x = centerX + Math.cos(angle) * dist;
      const y = centerY + Math.sin(angle) * dist;

      const size = 2 + seededUnit(`${seed}:size`) * 2; // 2-4 px.
      const baseOpacity = 0.2 + seededUnit(`${seed}:opacity`) * 0.7; // 0.2-0.9.
      const durationMs = 1000 + seededUnit(`${seed}:duration`) * 2000; // 1-3 sec.
      const phase = seededUnit(`${seed}:phase`) * Math.PI * 2;
      const colorIndex = Math.floor(seededUnit(`${seed}:color`) * starPalette.length) % starPalette.length;

      stars.push({
        data: {
          id: `star::${dir}::${i}`,
          color: starPalette[colorIndex],
          sizePx: `${size}`,
          baseOpacity: `${baseOpacity}`,
          twinkleSpeed: `${(Math.PI * 2) / durationMs}`,
          twinklePhase: `${phase}`
        },
        classes: "twinkle-star",
        position: { x, y },
        selectable: false,
        grabbable: false,
        pannable: false,
        locked: true
      });
    }
  }

  return stars;
}

export function createViewer(options: CreateViewerOptions): Core {
  const { container, graph, onNodeSelect, headless = false } = options;
  const positions = getDirectoryClusterPositions(graph.nodes);
  const minSize = Math.min(...graph.nodes.map(n => n.sizeBytes), 0);
  const maxSize = Math.max(...graph.nodes.map(n => n.sizeBytes), 1);
  const starElements = buildClusterStarElements(graph.nodes, positions);

  const elements = [
    ...starElements,
    ...graph.nodes.map(node => ({
      data: {
        id: node.id,
        label: node.path.split("/").pop() ?? node.id,
        path: node.path,
        dir: node.dir,
        ext: node.ext,
        loc: node.loc,
        riskScore: node.riskScore,
        inDegree: node.inDegree,
        outDegree: node.outDegree,
        sizeBytes: node.sizeBytes,
        color: dirColor(node.dir),
        sizePx: `${scaleSize(node.sizeBytes, minSize, maxSize, 22, 72)}`
      },
      position: positions[node.id]
    })),
    ...graph.edges.map(edge => ({
      data: {
        id: `${edge.source}-->${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: edge.type
      }
    }))
  ];

  const cy = cytoscape({
    container,
    headless,
    elements,
    style: [
      {
        selector: "node:not(.twinkle-star)",
        style: {
          label: "data(label)",
          "background-color": "data(color)",
          width: "data(sizePx)",
          height: "data(sizePx)",
          "font-size": 11,
          color: "#deebff",
          "font-weight": 600,
          "text-wrap": "ellipsis",
          "text-max-width": "120",
          "text-valign": "top",
          "text-halign": "center",
          "text-margin-y": -13,
          "text-background-color": "rgba(7, 12, 30, 0.86)",
          "text-background-opacity": 1,
          "text-background-shape": "roundrectangle",
          "text-background-padding": "3",
          "text-outline-color": "#070b1f",
          "text-outline-width": 1,
          "border-width": 2.5,
          "border-color": "#d8e8ff",
          "border-opacity": 0.9,
          "shadow-blur": 24,
          "shadow-color": "data(color)",
          "shadow-opacity": 0.75,
          "shadow-offset-x": 0,
          "shadow-offset-y": 0,
          "overlay-opacity": 0,
          "transition-property": "border-width, border-color, shadow-blur, shadow-opacity, shadow-color, outline-width, outline-color",
          "transition-duration": "0.3s",
          "transition-timing-function": "ease-out"
        }
      },
      {
        selector: "node:selected:not(.twinkle-star)",
        style: {
          "border-width": 4,
          "border-color": "#ffffff",
          "z-index": 999
        }
      },
      {
        selector: "node.twinkle-star",
        style: {
          label: "",
          width: "data(sizePx)",
          height: "data(sizePx)",
          shape: "ellipse",
          "background-color": "data(color)",
          opacity: "data(baseOpacity)",
          "border-width": 0,
          "shadow-color": "data(color)",
          "shadow-opacity": 0.35,
          "shadow-blur": 10,
          "z-index-compare": "manual",
          "z-index": 0,
          events: "no"
        }
      },
      {
        selector: "edge",
        style: {
          width: 1.6,
          "line-color": "#8ba7ff",
          opacity: 0.78,
          "curve-style": "bezier",
          "target-arrow-color": "#c1d3ff",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.9,
          "target-distance-from-node": 8,
          "source-distance-from-node": 3,
          "shadow-blur": 10,
          "shadow-color": "#6f8dff",
          "shadow-opacity": 0.5,
          "overlay-opacity": 0
        }
      },
      {
        selector: ".dimmed",
        style: {
          opacity: 0.14,
          "text-opacity": 0.18
        }
      }
    ],
    // Use preset to keep nodes grouped by directory clusters from getDirectoryClusterPositions.
    layout: {
      name: "preset",
      fit: false,
      padding: 40
    },
    wheelSensitivity: 0.2,
    minZoom: 0.01,
    maxZoom: 4
  });

  let isFittingToView = false;
  let isConstrainingPan = false;
  const constrainPanToViewport = (): void => {
    if (headless || isConstrainingPan || isFittingToView) return;
    const width = cy.width();
    const height = cy.height();
    if (width <= 0 || height <= 0) return;

    const padding = 24;
    const bb = cy.elements().renderedBoundingBox({
      includeLabels: true,
      includeOverlays: false
    });
    if (!Number.isFinite(bb.w) || !Number.isFinite(bb.h)) return;

    let dx = 0;
    let dy = 0;

    if (bb.w <= width - padding * 2) {
      dx = width / 2 - (bb.x1 + bb.x2) / 2;
    } else {
      if (bb.x1 > padding) dx = padding - bb.x1;
      if (bb.x2 < width - padding) dx = (width - padding) - bb.x2;
    }

    if (bb.h <= height - padding * 2) {
      dy = height / 2 - (bb.y1 + bb.y2) / 2;
    } else {
      if (bb.y1 > padding) dy = padding - bb.y1;
      if (bb.y2 < height - padding) dy = (height - padding) - bb.y2;
    }

    if (dx !== 0 || dy !== 0) {
      isConstrainingPan = true;
      cy.panBy({ x: dx, y: dy });
      isConstrainingPan = false;
    }
  };

  const lockZoomOutAtFit = (): void => {
    if (headless || isFittingToView) return;

    isFittingToView = true;
    cy.animate(
      {
        fit: {
          eles: cy.elements(),
          padding: 80
        },
        duration: 760,
        easing: "ease-out-quart"
      },
      {
        complete: () => {
          const fitZoom = cy.zoom();
          cy.minZoom(fitZoom);
          isFittingToView = false;
          constrainPanToViewport();
        }
      }
    );
  };

  // Decorative stars twinkle independently using randomized phase/speed values.
  let twinkleRafId: number | null = null;
  const startStarTwinkle = (): void => {
    if (headless) return;
    const stars = cy.nodes(".twinkle-star");
    if (stars.length === 0) return;

    const start = performance.now();
    const animate = (now: number): void => {
      if (cy.destroyed()) return;
      const t = now - start;

      cy.batch(() => {
        stars.forEach(star => {
          const base = Number(star.data("baseOpacity")) || 0.45;
          const speed = Number(star.data("twinkleSpeed")) || 0.004;
          const phase = Number(star.data("twinklePhase")) || 0;
          const wave = 0.5 + 0.5 * Math.sin(t * speed + phase);
          const opacity = Math.max(0.2, Math.min(0.9, base * 0.55 + wave * 0.45));
          star.style("opacity", `${opacity}`);
        });
      });

      twinkleRafId = requestAnimationFrame(animate);
    };

    twinkleRafId = requestAnimationFrame(animate);
  };

  cy.on("tap", "node:not(.twinkle-star)", event => {
    onNodeSelect?.(event.target.id());
  });
  cy.on("tap", event => {
    if (event.target === cy) onNodeSelect?.(null);
  });
  cy.on("layoutstop", lockZoomOutAtFit);
  cy.on("layoutstop", constrainPanToViewport);
  cy.on("pan zoom resize", constrainPanToViewport);
  cy.on("destroy", () => {
    if (twinkleRafId !== null) {
      cancelAnimationFrame(twinkleRafId);
      twinkleRafId = null;
    }
  });
  cy.ready(lockZoomOutAtFit);
  cy.ready(constrainPanToViewport);
  cy.ready(startStarTwinkle);

  return cy;
}
