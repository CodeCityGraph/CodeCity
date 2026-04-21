import graph from "./graph.json";
import { createGraphFromZip } from "./analyzer";
import type { GraphData } from "./types";
import { createViewer } from "./viewer";
import "./style.css";

const LLM_API_URL = "http://localhost:8002";
let detailsRequestCounter = 0;

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
const appRoot = requiredElement<HTMLElement>("app");
const fileInput = requiredElement<HTMLInputElement>("repoZipInput");
const sampleButton = requiredElement<HTMLButtonElement>("loadSample");
const searchInput = requiredElement<HTMLInputElement>("searchInput");
const focusButton = requiredElement<HTMLButtonElement>("focusButton");
const bottleneckCountInput = requiredElement<HTMLInputElement>("bottleneckCount");
const applyBottleneckFilterButton = requiredElement<HTMLButtonElement>("applyBottleneckFilter");
const clearBottleneckFilterButton = requiredElement<HTMLButtonElement>("clearBottleneckFilter");
const statusLabel = requiredElement<HTMLParagraphElement>("status");
const detailsPanel = requiredElement<HTMLDivElement>("details");

function playGalaxyEntryAnimation(): void {
  appRoot.classList.remove("warp-in");
  // Force reflow so the animation restarts when the graph is re-rendered.
  void appRoot.offsetWidth;
  appRoot.classList.add("warp-in");
  window.setTimeout(() => appRoot.classList.remove("warp-in"), 2300);
}

let cy = createViewer({
  container,
  graph: normalizeSampleGraph(graph),
  onNodeSelect: renderDetails
});

function setStatus(text: string): void {
  statusLabel.textContent = text;
}

function renderDetails(nodeId: string | null): void {
  const requestId = ++detailsRequestCounter;
  if (!nodeId) {
    detailsPanel.innerHTML = "<p>Select a node to inspect details.</p>";
    return;
  }
  const node = cy.getElementById(nodeId);
  if (!node || node.empty()) return;
  const indicators: string[] = [];
  if (Boolean(node.data("isHighCoupling"))) indicators.push("Highly coupled");
  if (Boolean(node.data("isCritical"))) indicators.push("Critical");

  detailsPanel.innerHTML = `
    <h4>${node.data("label")}</h4>
    <p><strong>Path:</strong> ${node.data("path")}</p>
    <p><strong>Directory:</strong> ${node.data("dir")}</p>
    <p><strong>Ext:</strong> ${node.data("ext") || "(none)"}</p>
    <p><strong>LOC:</strong> ${node.data("loc")}</p>
    <p><strong>Size:</strong> ${node.data("sizeBytes")} bytes</p>
    <p><strong>In/Out:</strong> ${node.data("inDegree")} / ${node.data("outDegree")}</p>
    <p><strong>Coupling:</strong> ${node.data("coupling")}</p>
    <p><strong>Risk:</strong> ${Number(node.data("riskScore")).toFixed(2)}</p>
    <p><strong>Indicators:</strong> ${indicators.length > 0 ? indicators.join(" | ") : "None"}</p>
    <p><strong>CodeLlama Summary:</strong></p>
    <p id="llm-explanation" data-request-id="${requestId}">Loading explanation...</p>
  `;

  void populateNodeExplanation(nodeId, requestId);
}

async function populateNodeExplanation(nodeId: string, requestId: number): Promise<void> {
  const node = cy.getElementById(nodeId);
  if (!node || node.empty()) return;

  const path = String(node.data("path") ?? nodeId);
  const dir = String(node.data("dir") ?? "unknown");
  const outgoing = Number(node.data("outDegree") ?? 0);
  const incoming = Number(node.data("inDegree") ?? 0);
  const relatedFiles = node
    .connectedEdges()
    .connectedNodes()
    .filter(n => n.id() !== nodeId)
    .map(n => String(n.data("path") ?? n.id()))
    .slice(0, 6);

  let explanation = "CodeLlama is unavailable for this node.";

  try {
    const response = await fetch(`${LLM_API_URL}/api/analyze_file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: path,
        directory: dir,
        outgoing,
        incoming,
        related_files: relatedFiles
      })
    });

    if (response.ok) {
      const data = (await response.json()) as { description?: string };
      if (data.description && data.description.trim().length > 0) {
        explanation = data.description.trim();
      } else {
        explanation = "CodeLlama returned an empty explanation.";
      }
    } else {
      explanation = `CodeLlama request failed (${response.status}).`;
    }
  } catch {
    explanation = "Could not reach local CodeLlama server on port 8002.";
  }

  const target = detailsPanel.querySelector(
    `#llm-explanation[data-request-id=\"${requestId}\"]`
  ) as HTMLParagraphElement | null;

  if (!target || requestId !== detailsRequestCounter) return;
  target.textContent = explanation;
}

function reloadViewer(nextGraph: GraphData): void {
  cy.destroy();
  cy = createViewer({
    container,
    graph: nextGraph,
    onNodeSelect: renderDetails
  });
  playGalaxyEntryAnimation();
}

function clearBottleneckFilter(): void {
  cy.nodes().removeClass("bottleneck-hidden");
  cy.edges().removeClass("bottleneck-hidden");
}

function applyBottleneckFilter(count: number): void {
  const sanitizedCount = Math.max(1, Math.floor(count));
  const sortedNodes = cy
    .nodes()
    .toArray()
    .sort((a, b) => {
      const byIncoming = Number(b.data("inDegree") ?? 0) - Number(a.data("inDegree") ?? 0);
      if (byIncoming !== 0) return byIncoming;
      return Number(b.data("outDegree") ?? 0) - Number(a.data("outDegree") ?? 0);
    });

  const candidates = sortedNodes.filter(node => Number(node.data("inDegree") ?? 0) > 0);
  const selected = candidates.slice(0, sanitizedCount);
  const selectedIds = new Set(selected.map(node => node.id()));
  const selectedDirs = new Set(selected.map(node => String(node.data("dir") ?? "")));

  cy.batch(() => {
    cy.nodes().forEach(node => {
      if (node.hasClass("twinkle-star")) {
        const starDir = String(node.data("dir") ?? "");
        node.toggleClass("bottleneck-hidden", !selectedDirs.has(starDir));
        return;
      }
      node.toggleClass("bottleneck-hidden", !selectedIds.has(node.id()));
    });
    cy.edges().forEach(edge => {
      const sourceId = edge.source().id();
      const targetId = edge.target().id();
      edge.toggleClass("bottleneck-hidden", !(selectedIds.has(sourceId) && selectedIds.has(targetId)));
    });
  });

  if (selected.length > 0) {
    let selectedCollection = cy.collection();
    selected.forEach(node => {
      selectedCollection = selectedCollection.union(node);
    });
    cy.fit(selectedCollection, 70);
    setStatus(`Showing top ${selected.length} depended-on file(s) by incoming dependencies.`);
  } else {
    setStatus("No depended-on files were found to filter.");
  }
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
  clearBottleneckFilter();
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
    clearBottleneckFilter();
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
  const searchableNodes = nodes.filter(node => !node.hasClass("twinkle-star"));

  nodes.removeClass("dimmed");
  cy.edges().removeClass("dimmed");

  if (!query) {
    setStatus("Filter cleared.");
    return;
  }

  let matches = searchableNodes.filter(node => {
    const path = String(node.data("path"));
    return !node.hasClass("bottleneck-hidden") && matchesQuery(path, query);
  });

  let revealedFromBottleneckFilter = false;
  const hasActiveBottleneckFilter =
    cy.nodes(".bottleneck-hidden").length > 0 || cy.edges(".bottleneck-hidden").length > 0;

  if (matches.length === 0 && hasActiveBottleneckFilter) {
    clearBottleneckFilter();
    revealedFromBottleneckFilter = true;
    matches = searchableNodes.filter(node => {
      const path = String(node.data("path"));
      return matchesQuery(path, query);
    });
  }

  nodes.addClass("dimmed");
  cy.edges().addClass("dimmed");
  matches.removeClass("dimmed");
  matches.connectedEdges().removeClass("dimmed");
  matches.connectedEdges().connectedNodes().removeClass("dimmed");

  if (matches.length > 0) {
    cy.fit(matches, 70);
    if (revealedFromBottleneckFilter) {
      setStatus(`Revealed filtered nodes and focused ${matches.length} node(s) for "${query}".`);
    } else {
      setStatus(`Focused ${matches.length} node(s) for "${query}".`);
    }
  } else {
    setStatus(`No files matched "${query}". Try filename-only like "userService".`);
  }
});

applyBottleneckFilterButton.addEventListener("click", () => {
  const requested = Number(bottleneckCountInput.value);
  const fallback = 10;
  const count = Number.isFinite(requested) && requested > 0 ? requested : fallback;
  bottleneckCountInput.value = `${Math.max(1, Math.floor(count))}`;
  applyBottleneckFilter(count);
  renderDetails(null);
});

clearBottleneckFilterButton.addEventListener("click", () => {
  clearBottleneckFilter();
  setStatus("Bottleneck filter cleared.");
});

playGalaxyEntryAnimation();
