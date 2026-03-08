import graph from "./graph.json";
import { createGraphFromZip } from "./analyzer";
import type { GraphData } from "./types";
import { createViewer } from "./viewer";
import "./style.css";

function normalizeSampleGraph(raw: typeof graph): GraphData {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  raw.nodes.forEach(node => {
    inDegree.set(node.id, 0);
    outDegree.set(node.id, 0);
  });
  raw.edges.forEach(edge => {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  });

  return {
    nodes: raw.nodes.map(node => ({
      id: node.id,
      path: node.id,
      dir: node.dir,
      ext: node.id.includes(".") ? `.${node.id.split(".").pop()}` : "",
      sizeBytes: 200,
      loc: 15,
      inDegree: inDegree.get(node.id) ?? 0,
      outDegree: outDegree.get(node.id) ?? 0,
      riskScore:
        (inDegree.get(node.id) ?? 0) +
        (outDegree.get(node.id) ?? 0) +
        Math.log(200)
    })),
    edges: raw.edges.map(edge => ({
      source: edge.source,
      target: edge.target,
      type: "import" as const
    })),
    unresolvedImports: []
  };
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

const container = requiredElement<HTMLElement>("cy");
const fileInput = requiredElement<HTMLInputElement>("repoZipInput");
const sampleButton = requiredElement<HTMLButtonElement>("loadSample");
const searchInput = requiredElement<HTMLInputElement>("searchInput");
const focusButton = requiredElement<HTMLButtonElement>("focusButton");
const statusLabel = requiredElement<HTMLParagraphElement>("status");
const detailsPanel = requiredElement<HTMLDivElement>("details");

let cy = createViewer({
  container,
  graph: normalizeSampleGraph(graph),
  onNodeSelect: renderDetails
});

function setStatus(text: string): void {
  statusLabel.textContent = text;
}

function renderDetails(nodeId: string | null): void {
  if (!nodeId) {
    detailsPanel.innerHTML = "<p>Select a node to inspect details.</p>";
    return;
  }
  const node = cy.getElementById(nodeId);
  if (!node || node.empty()) return;
  detailsPanel.innerHTML = `
    <h4>${node.data("label")}</h4>
    <p><strong>Path:</strong> ${node.data("path")}</p>
    <p><strong>Directory:</strong> ${node.data("dir")}</p>
    <p><strong>Ext:</strong> ${node.data("ext") || "(none)"}</p>
    <p><strong>LOC:</strong> ${node.data("loc")}</p>
    <p><strong>Size:</strong> ${node.data("sizeBytes")} bytes</p>
    <p><strong>In/Out:</strong> ${node.data("inDegree")} / ${node.data("outDegree")}</p>
    <p><strong>Risk:</strong> ${Number(node.data("riskScore")).toFixed(2)}</p>
  `;
}

function reloadViewer(nextGraph: GraphData): void {
  cy.destroy();
  cy = createViewer({
    container,
    graph: nextGraph,
    onNodeSelect: renderDetails
  });
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\\/g, "/");
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function tokenMatches(pathToken: string, queryToken: string): boolean {
  if (pathToken.includes(queryToken) || queryToken.includes(pathToken)) return true;
  if (pathToken.endsWith("s") && pathToken.slice(0, -1) === queryToken) return true;
  if (queryToken.endsWith("s") && queryToken.slice(0, -1) === pathToken) return true;
  return false;
}

function matchesQuery(path: string, query: string): boolean {
  const normalizedPath = normalizeText(path);
  const normalizedQuery = normalizeText(query);
  if (normalizedPath.includes(normalizedQuery)) return true;

  const filename = normalizedPath.split("/").pop() ?? normalizedPath;
  if (filename.includes(normalizedQuery)) return true;

  const pathTokens = tokenize(normalizedPath);
  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.length === 0) return false;

  return queryTokens.every(queryToken =>
    pathTokens.some(pathToken => tokenMatches(pathToken, queryToken))
  );
}

sampleButton.addEventListener("click", () => {
  reloadViewer(normalizeSampleGraph(graph));
  setStatus("Loaded sample graph.");
  renderDetails(null);
});

fileInput.addEventListener("change", async event => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  setStatus(`Analyzing ${file.name}...`);
  try {
    const analyzed = await createGraphFromZip(file);
    reloadViewer(analyzed);
    setStatus(
      `Loaded ${analyzed.nodes.length} files, ${analyzed.edges.length} edges. ` +
      `Unresolved imports: ${analyzed.unresolvedImports.length}`
    );
    renderDetails(null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Failed to analyze zip: ${message}`);
  }
});

focusButton.addEventListener("click", () => {
  const query = searchInput.value.trim();
  const nodes = cy.nodes();
  if (!query) {
    nodes.removeClass("dimmed");
    cy.edges().removeClass("dimmed");
    setStatus("Filter cleared.");
    return;
  }

  const matches = nodes.filter(node => {
    const path = String(node.data("path"));
    return matchesQuery(path, query);
  });

  nodes.addClass("dimmed");
  cy.edges().addClass("dimmed");
  matches.removeClass("dimmed");
  matches.connectedEdges().removeClass("dimmed");
  matches.connectedEdges().connectedNodes().removeClass("dimmed");

  if (matches.length > 0) {
    cy.fit(matches, 70);
    setStatus(`Focused ${matches.length} node(s) for "${query}".`);
  } else {
    setStatus(`No files matched "${query}". Try filename-only like "userService".`);
  }
});
