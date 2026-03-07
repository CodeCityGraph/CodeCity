import cytoscape, { type Core } from "cytoscape";
import { getDirectoryClusterPositions } from "./layout";
import type { GraphData } from "./types";

interface CreateViewerOptions {
  container?: HTMLElement;
  graph: GraphData;
  onNodeSelect?: (nodeId: string | null) => void;
  headless?: boolean;
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

export function createViewer(options: CreateViewerOptions): Core {
  const { container, graph, onNodeSelect, headless = false } = options;
  const positions = getDirectoryClusterPositions(graph.nodes);
  const minSize = Math.min(...graph.nodes.map(n => n.sizeBytes), 0);
  const maxSize = Math.max(...graph.nodes.map(n => n.sizeBytes), 1);

  const elements = [
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
        selector: "node",
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
        selector: "node:selected",
        style: {
          "border-width": 4,
          "border-color": "#ffffff",
          "z-index": 999
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
    layout: {
      name: "cose",
      animate: true,
      randomize: false,
      padding: 40,
      nodeRepulsion: 14000,
      idealEdgeLength: 130,
      edgeElasticity: 120
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

  cy.on("tap", "node", event => {
    onNodeSelect?.(event.target.id());
  });
  cy.on("tap", event => {
    if (event.target === cy) onNodeSelect?.(null);
  });
  cy.on("layoutstop", lockZoomOutAtFit);
  cy.on("layoutstop", constrainPanToViewport);
  cy.on("pan zoom resize", constrainPanToViewport);
  cy.ready(lockZoomOutAtFit);
  cy.ready(constrainPanToViewport);

  return cy;
}
