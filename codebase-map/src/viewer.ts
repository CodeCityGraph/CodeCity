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
    "#264653",
    "#2a9d8f",
    "#e76f51",
    "#457b9d",
    "#8ab17d",
    "#6d597a",
    "#b56576",
    "#f4a261",
    "#3a86ff"
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
          color: "#102a43",
          "font-weight": 700,
          "text-wrap": "ellipsis",
          "text-max-width": "110",
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 10,
          "text-background-color": "#ffffff",
          "text-background-opacity": 0.9,
          "text-background-shape": "roundrectangle",
          "text-background-padding": "2",
          "border-width": 2,
          "border-color": "#ffffff",
          "border-opacity": 0.85,
          "overlay-opacity": 0
        }
      },
      {
        selector: "node:selected",
        style: {
          "border-width": 4,
          "border-color": "#ffba08"
        }
      },
      {
        selector: "edge",
        style: {
          width: 1.4,
          "line-color": "#6b7280",
          opacity: 0.75,
          "curve-style": "bezier",
          "target-arrow-color": "#6b7280",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.75,
          "overlay-opacity": 0
        }
      },
      {
        selector: ".dimmed",
        style: {
          opacity: 0.17
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

  const lockZoomOutAtFit = (): void => {
    if (headless) return;
    cy.fit(undefined, 80);
    const fitZoom = cy.zoom();
    cy.minZoom(fitZoom);
  };

  let isConstrainingPan = false;
  const constrainPanToViewport = (): void => {
    if (headless || isConstrainingPan) return;
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
