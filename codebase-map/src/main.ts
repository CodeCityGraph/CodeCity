import graph from "./graph.json";
import { createGraphFromZip, createGraphFromZipBuffer, type AnalysisProgress } from "./analyzer";
import type { GraphData } from "./types";
import { createViewer } from "./viewer";
import {
  exportArchitectureRiskTxt,
  exportGraphPng,
  exportMetricsCsv,
  exportMetricsJson,
  exportPdfReport
} from "./reporting";
import { matchesSemanticQuery } from "./semanticSearch";
import type { ClusteringMode } from "./layout";
import "./style.css";

const LLM_API_URL = "http://localhost:8002";
const LLM_TIMEOUT_MS = 10000;

let detailsRequestCounter = 0;
let currentSelectedNodeId: string | null = null;

type EdgeDirection = "all" | "incoming" | "outgoing";
type ViewMode = "single" | "comparison";

interface FilterState {
  searchQuery: string;
  advancedQuery: string;
  useSemanticSearch: boolean;
  topDependedPercent: number;
  neighborhoodHops: number;
  edgeDirection: EdgeDirection;
  showStaticEdges: boolean;
  showDynamicEdges: boolean;
  showInternalEdges: boolean;
  showExternalEdges: boolean;
  showOrphanModulesOnly: boolean;
  highlightGodFiles: boolean;
  scalabilityMode: boolean;
  clusteringMode: ClusteringMode;
  minRiskScore: number;
}

interface GitHubRepoInput {
  owner: string;
  repo: string;
  ref: string | null;
}

interface ComparisonSummary {
  beforeNodes: number;
  afterNodes: number;
  sharedNodes: number;
  removedNodes: number;
  beforeEdges: number;
  afterEdges: number;
  sharedEdges: number;
  removedEdges: number;
}

const filterState: FilterState = {
  searchQuery: "",
  advancedQuery: "",
  useSemanticSearch: false,
  topDependedPercent: 100,
  neighborhoodHops: 1,
  edgeDirection: "all",
  showStaticEdges: true,
  showDynamicEdges: true,
  showInternalEdges: true,
  showExternalEdges: true,
  showOrphanModulesOnly: false,
  highlightGodFiles: false,
  scalabilityMode: true,
  clusteringMode: "directory",
  minRiskScore: 0
};

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
      category: "source" as const,
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
      type: "import" as const,
      scope: "internal" as const
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
const secondaryContainer = requiredElement<HTMLElement>("cySecondary");
const graphPaneSecondary = requiredElement<HTMLDivElement>("graphPaneSecondary");
const paneBeforeLabel = requiredElement<HTMLParagraphElement>("paneBeforeLabel");
const paneAfterLabel = requiredElement<HTMLParagraphElement>("paneAfterLabel");
const appRoot = requiredElement<HTMLElement>("app");
const viewModeSelect = requiredElement<HTMLSelectElement>("viewModeSelect");
const singleModeControls = requiredElement<HTMLDivElement>("singleModeControls");
const comparisonModeControls = requiredElement<HTMLDivElement>("comparisonModeControls");
const fileInput = requiredElement<HTMLInputElement>("repoZipInput");
const githubRepoInput = requiredElement<HTMLInputElement>("githubRepoInput");
const loadGithubRepoButton = requiredElement<HTMLButtonElement>("loadGithubRepo");
const sampleButton = requiredElement<HTMLButtonElement>("loadSample");
const compareRepoInput = requiredElement<HTMLInputElement>("compareRepoInput");
const compareBeforeRefInput = requiredElement<HTMLInputElement>("compareBeforeRefInput");
const compareAfterRefInput = requiredElement<HTMLInputElement>("compareAfterRefInput");
const compareRepoButton = requiredElement<HTMLButtonElement>("compareRepoButton");
const compareBeforeZipInput = requiredElement<HTMLInputElement>("compareBeforeZipInput");
const compareAfterZipInput = requiredElement<HTMLInputElement>("compareAfterZipInput");
const compareZipButton = requiredElement<HTMLButtonElement>("compareZipButton");
const searchInput = requiredElement<HTMLInputElement>("searchInput");
const focusButton = requiredElement<HTMLButtonElement>("focusButton");
const resetFiltersButton = requiredElement<HTMLButtonElement>("resetFiltersButton");
const topDependedRange = requiredElement<HTMLInputElement>("topDependedRange");
const topDependedValue = requiredElement<HTMLParagraphElement>("topDependedValue");
const neighborhoodSelect = requiredElement<HTMLSelectElement>("neighborhoodSelect");
const edgeDirectionSelect = requiredElement<HTMLSelectElement>("edgeDirectionSelect");
const toggleClusteringMode = requiredElement<HTMLInputElement>("toggleClusteringMode");
const advancedQueryInput = requiredElement<HTMLInputElement>("advancedQueryInput");
const advancedSearchButton = requiredElement<HTMLButtonElement>("advancedSearchButton");
const riskFilterRange = requiredElement<HTMLInputElement>("riskFilterRange");
const riskFilterValue = requiredElement<HTMLParagraphElement>("riskFilterValue");
const toggleStaticEdges = requiredElement<HTMLInputElement>("toggleStaticEdges");
const toggleDynamicEdges = requiredElement<HTMLInputElement>("toggleDynamicEdges");
const toggleInternalEdges = requiredElement<HTMLInputElement>("toggleInternalEdges");
const toggleExternalEdges = requiredElement<HTMLInputElement>("toggleExternalEdges");
const toggleLlmSummary = requiredElement<HTMLInputElement>("toggleLlmSummary");
const toggleScalabilityMode = requiredElement<HTMLInputElement>("toggleScalabilityMode");
const toggleOrphanModules = requiredElement<HTMLInputElement>("toggleOrphanModules");
const toggleGodFiles = requiredElement<HTMLInputElement>("toggleGodFiles");
const statusLabel = requiredElement<HTMLParagraphElement>("status");
const architectureChecksStatus = requiredElement<HTMLParagraphElement>("architectureChecksStatus");
const emptyStatePrompt = requiredElement<HTMLDivElement>("emptyStatePrompt");

interface WorkerAnalyzeRequest {
  type: "analyze";
  requestId: number;
  zipBuffer: ArrayBuffer;
}

interface WorkerProgressMessage {
  type: "progress";
  requestId: number;
  progress: AnalysisProgress;
}

interface WorkerResultMessage {
  type: "result";
  requestId: number;
  graph: GraphData;
}

interface WorkerErrorMessage {
  type: "error";
  requestId: number;
  message: string;
}

type WorkerMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;

function setAnalysisLoadingState(isLoading: boolean): void {
  fileInput.disabled = isLoading;
  sampleButton.disabled = isLoading;
  loadGithubRepoButton.disabled = isLoading;
  githubRepoInput.disabled = isLoading;
}

function formatAnalysisProgress(progress: AnalysisProgress, label: string): string {
  const base = `${label}`;
  if (progress.stage === "loading") {
    return `${base} - opening archive...`;
  }
  if (progress.stage === "reading-files") {
    return `${base} - reading files (${progress.processedFiles}/${progress.totalFiles})${progress.currentPath ? `: ${progress.currentPath}` : ""}`;
  }
  if (progress.stage === "building-graph") {
    return `${base} - building dependency graph (${progress.processedFiles}/${progress.totalFiles})...`;
  }
  return `${base} - analysis complete.`;
}

let analysisWorker: Worker | null = null;
let analysisRequestCounter = 0;

function getAnalysisWorker(): Worker | null {
  if (!("Worker" in window)) return null;
  if (!analysisWorker) {
    analysisWorker = new Worker(new URL("./analysisWorker.ts", import.meta.url), { type: "module" });
  }
  return analysisWorker;
}

async function analyzeZipBuffer(zipBuffer: ArrayBuffer, label: string): Promise<GraphData> {
  const worker = getAnalysisWorker();
  if (!worker) {
    return createGraphFromZipBuffer(zipBuffer);
  }

  return new Promise<GraphData>((resolve, reject) => {
    const requestId = ++analysisRequestCounter;

    const cleanup = (): void => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    };

    const handleError = (): void => {
      cleanup();
      reject(new Error("Web Worker analysis failed."));
    };

    const handleMessage = (event: MessageEvent): void => {
      const message = event.data as WorkerMessage;
      if (message.requestId !== requestId) return;

      if (message.type === "progress") {
        setStatus(formatAnalysisProgress(message.progress, label));
        return;
      }

      cleanup();

      if (message.type === "error") {
        reject(new Error(message.message));
        return;
      }

      resolve(message.graph);
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    setStatus(`Analyzing ${label} in a Web Worker...`);
    worker.postMessage({ type: "analyze", requestId, zipBuffer } satisfies WorkerAnalyzeRequest, [zipBuffer]);
  });
}
const detailsPanel = requiredElement<HTMLDivElement>("details");
const exportFormatSelect = requiredElement<HTMLSelectElement>("exportFormatSelect");
const exportButton = requiredElement<HTMLButtonElement>("exportButton");

function playGalaxyEntryAnimation(): void {
  appRoot.classList.remove("warp-in");
  // Force reflow so the animation restarts when the graph is re-rendered.
  void appRoot.offsetWidth;
  appRoot.classList.add("warp-in");
  window.setTimeout(() => appRoot.classList.remove("warp-in"), 2300);
}

function setStatus(text: string): void {
  statusLabel.textContent = text;
}

function setArchitectureChecksStatus(text: string): void {
  architectureChecksStatus.textContent = text;
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

function parseGitHubRepoInput(input: string): GitHubRepoInput {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("GitHub URL is empty.");

  const shorthandMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/tree\/(.+))?$/);
  if (shorthandMatch) {
    return {
      owner: shorthandMatch[1],
      repo: shorthandMatch[2].replace(/\.git$/i, ""),
      ref: shorthandMatch[3] ? decodeURIComponent(shorthandMatch[3]) : null
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Use a valid GitHub URL like https://github.com/owner/repo");
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw new Error("Only github.com repository URLs are supported.");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("GitHub URL should include owner and repo.");
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  const ref = parts[2] === "tree" && parts.length >= 4
    ? decodeURIComponent(parts.slice(3).join("/"))
    : null;

  return { owner, repo, ref };
}

async function downloadGitHubZip(repoInput: GitHubRepoInput): Promise<{ zipBuffer: ArrayBuffer; resolvedRef: string }> {
  const response = await fetch(`${LLM_API_URL}/api/fetch_github_zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(repoInput)
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = payload.detail ? ` ${payload.detail}` : "";
    } catch {
      // Ignore non-JSON error payloads.
    }
    throw new Error(`Proxy request failed (${response.status}).${detail}`);
  }

  const resolvedRef = response.headers.get("x-github-resolved-ref") ?? repoInput.ref ?? "default branch";
  const zipBuffer = await response.arrayBuffer();
  return { zipBuffer, resolvedRef };
}

function setGithubLoadingState(isLoading: boolean): void {
  loadGithubRepoButton.disabled = isLoading;
  githubRepoInput.disabled = isLoading;
}

function setComparisonLoadingState(isLoading: boolean): void {
  compareRepoInput.disabled = isLoading;
  compareBeforeRefInput.disabled = isLoading;
  compareAfterRefInput.disabled = isLoading;
  compareRepoButton.disabled = isLoading;
  compareBeforeZipInput.disabled = isLoading;
  compareAfterZipInput.disabled = isLoading;
  compareZipButton.disabled = isLoading;
}

function setSideBySideMode(enabled: boolean): void {
  graphPaneSecondary.hidden = !enabled;
}

function setViewMode(mode: ViewMode): void {
  viewModeSelect.value = mode;
  singleModeControls.hidden = mode !== "single";
  comparisonModeControls.hidden = mode !== "comparison";
  paneBeforeLabel.hidden = mode !== "comparison";
  paneAfterLabel.hidden = mode !== "comparison";

  if (mode === "single") {
    if (cySecondary) {
      cySecondary.destroy();
      cySecondary = null;
    }
    setSideBySideMode(false);
    paneBeforeLabel.textContent = "Current view";
    paneAfterLabel.textContent = "After";
  }
}

function inferCommonRootSegment(graph: GraphData): string | null {
  const sourcePaths = graph.nodes
    .filter(node => node.category === "source")
    .map(node => node.path)
    .filter(path => path.includes("/"));

  if (sourcePaths.length === 0) return null;

  const counts = new Map<string, number>();
  sourcePaths.forEach(path => {
    const segment = path.split("/")[0];
    counts.set(segment, (counts.get(segment) ?? 0) + 1);
  });

  let bestSegment: string | null = null;
  let bestCount = 0;
  counts.forEach((count, segment) => {
    if (count > bestCount) {
      bestSegment = segment;
      bestCount = count;
    }
  });

  // Archive snapshots typically have a generated top-level folder shared by most files.
  return bestCount / sourcePaths.length >= 0.7 ? bestSegment : null;
}

function stripRootSegment(path: string, rootSegment: string | null): string {
  if (!rootSegment) return path;
  if (!path.startsWith(`${rootSegment}/`)) return path;
  return path.slice(rootSegment.length + 1);
}

function nodeComparableKey(node: GraphData["nodes"][number], rootSegment: string | null): string {
  if (node.category === "external") {
    return `external:${node.path.toLowerCase()}`;
  }
  return stripRootSegment(node.path, rootSegment).toLowerCase();
}

function edgeComparableKey(
  edge: GraphData["edges"][number],
  nodeKeyById: Map<string, string>
): string {
  const sourceKey = nodeKeyById.get(edge.source);
  const targetKey = nodeKeyById.get(edge.target);
  if (!sourceKey || !targetKey) return "";
  return `${sourceKey}-->${targetKey}|${edge.type}|${edge.scope}`;
}

interface ComparisonDiffResult {
  summary: ComparisonSummary;
  beforeSharedNodeIds: Set<string>;
  beforeRemovedNodeIds: Set<string>;
  beforeSharedEdgeIds: Set<string>;
  beforeRemovedEdgeIds: Set<string>;
  afterSharedNodeIds: Set<string>;
  afterAddedNodeIds: Set<string>;
  afterSharedEdgeIds: Set<string>;
  afterAddedEdgeIds: Set<string>;
}

function buildComparisonDiff(before: GraphData, after: GraphData): ComparisonDiffResult {
  const beforeRoot = inferCommonRootSegment(before);
  const afterRoot = inferCommonRootSegment(after);

  const beforeNodeKeyById = new Map(
    before.nodes.map(node => [node.id, nodeComparableKey(node, beforeRoot)])
  );
  const afterNodeKeyById = new Map(
    after.nodes.map(node => [node.id, nodeComparableKey(node, afterRoot)])
  );

  const afterNodeKeys = new Set(afterNodeKeyById.values());
  const sharedNodeIds = new Set(
    before.nodes
      .filter(node => afterNodeKeys.has(beforeNodeKeyById.get(node.id) ?? ""))
      .map(node => node.id)
  );
  const sharedNodeKeys = new Set(
    before.nodes
      .filter(node => sharedNodeIds.has(node.id))
      .map(node => beforeNodeKeyById.get(node.id) ?? "")
      .filter(Boolean)
  );

  const sharedNodes = before.nodes.filter(node => sharedNodeIds.has(node.id));
  const afterSharedNodeIds = new Set(
    after.nodes
      .filter(node => sharedNodeKeys.has(afterNodeKeyById.get(node.id) ?? ""))
      .map(node => node.id)
  );

  const afterEdgeKeys = new Set(
    after.edges
      .map(edge => edgeComparableKey(edge, afterNodeKeyById))
      .filter(Boolean)
  );
  const sharedEdges = before.edges.filter(edge => {
    if (!sharedNodeIds.has(edge.source) || !sharedNodeIds.has(edge.target)) return false;

    const sourceKey = beforeNodeKeyById.get(edge.source);
    const targetKey = beforeNodeKeyById.get(edge.target);
    if (!sourceKey || !targetKey) return false;
    if (!sharedNodeKeys.has(sourceKey) || !sharedNodeKeys.has(targetKey)) return false;

    const key = edgeComparableKey(edge, beforeNodeKeyById);
    return key.length > 0 && afterEdgeKeys.has(key);
  });
  const sharedEdgeKeys = new Set(
    sharedEdges.map(edge => edgeComparableKey(edge, beforeNodeKeyById)).filter(Boolean)
  );

  const beforeSharedEdgeIds = new Set(sharedEdges.map(edge => `${edge.source}-->${edge.target}`));
  const beforeRemovedEdgeIds = new Set(
    before.edges
      .filter(edge => !beforeSharedEdgeIds.has(`${edge.source}-->${edge.target}`))
      .map(edge => `${edge.source}-->${edge.target}`)
  );

  const afterSharedEdgeIds = new Set(
    after.edges
      .filter(edge => {
        const key = edgeComparableKey(edge, afterNodeKeyById);
        return key.length > 0 && sharedEdgeKeys.has(key);
      })
      .map(edge => `${edge.source}-->${edge.target}`)
  );
  const afterAddedEdgeIds = new Set(
    after.edges
      .filter(edge => !afterSharedEdgeIds.has(`${edge.source}-->${edge.target}`))
      .map(edge => `${edge.source}-->${edge.target}`)
  );

  const summary: ComparisonSummary = {
    beforeNodes: before.nodes.length,
    afterNodes: after.nodes.length,
    sharedNodes: sharedNodes.length,
    removedNodes: Math.max(0, before.nodes.length - sharedNodes.length),
    beforeEdges: before.edges.length,
    afterEdges: after.edges.length,
    sharedEdges: sharedEdges.length,
    removedEdges: Math.max(0, before.edges.length - sharedEdges.length)
  };

  return {
    summary,
    beforeSharedNodeIds: sharedNodeIds,
    beforeRemovedNodeIds: new Set(before.nodes.filter(node => !sharedNodeIds.has(node.id)).map(node => node.id)),
    beforeSharedEdgeIds,
    beforeRemovedEdgeIds,
    afterSharedNodeIds,
    afterAddedNodeIds: new Set(after.nodes.filter(node => !afterSharedNodeIds.has(node.id)).map(node => node.id)),
    afterSharedEdgeIds,
    afterAddedEdgeIds
  };
}

function applyDiffClasses(
  targetCy: ReturnType<typeof createViewer>,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
  nodeClass: string,
  edgeClass: string
): void {
  targetCy.batch(() => {
    nodeIds.forEach(id => {
      const node = targetCy.getElementById(id);
      if (!node.empty()) node.addClass(nodeClass);
    });
    edgeIds.forEach(id => {
      const edge = targetCy.getElementById(id);
      if (!edge.empty()) edge.addClass(edgeClass);
    });
  });
}

function renderComparisonView(beforeGraph: GraphData, afterGraph: GraphData, beforeLabel: string, afterLabel: string): ComparisonSummary {
  setViewMode("comparison");
  const diff = buildComparisonDiff(beforeGraph, afterGraph);

  if (cySecondary) {
    cySecondary.destroy();
    cySecondary = null;
  }

  currentGraphData = beforeGraph;
  cy.destroy();
  currentSelectedNodeId = null;
  detailsRequestCounter += 1;

  setSideBySideMode(true);
  paneBeforeLabel.textContent = `Before: ${beforeLabel}`;
  paneAfterLabel.textContent = `After: ${afterLabel}`;

  cy = createViewer({
    container,
    graph: beforeGraph,
    onNodeSelect: renderDetails
  });
  cySecondary = createViewer({
    container: secondaryContainer,
    graph: afterGraph
  });

  applyDiffClasses(cy, diff.beforeSharedNodeIds, diff.beforeSharedEdgeIds, "compare-shared", "compare-shared");
  applyDiffClasses(cy, diff.beforeRemovedNodeIds, diff.beforeRemovedEdgeIds, "compare-removed", "compare-removed");

  applyDiffClasses(cySecondary, diff.afterSharedNodeIds, diff.afterSharedEdgeIds, "compare-shared", "compare-shared");
  applyDiffClasses(cySecondary, diff.afterAddedNodeIds, diff.afterAddedEdgeIds, "compare-added", "compare-added");

  applyFilters();
  renderDetails(null);
  playGalaxyEntryAnimation();
  return diff.summary;
}

function intersects(base: Set<string>, incoming: Set<string>): Set<string> {
  const next = new Set<string>();
  base.forEach(id => {
    if (incoming.has(id)) next.add(id);
  });
  return next;
}

function formatTopDependedLabel(percent: number): void {
  topDependedValue.textContent = `Showing top ${percent}% by in-degree.`;
}

function getTopDependedNodeContext(percent: number): Set<string> {
  const sourceNodes = cy
    .$("node")
    .filter(node => !node.hasClass("twinkle-star") && node.data("category") === "source")
    .toArray();

  if (sourceNodes.length === 0 || percent >= 100) {
    return new Set(
      cy
        .nodes()
        .filter(node => !node.hasClass("twinkle-star"))
        .map(node => node.id())
    );
  }

  const sorted = [...sourceNodes].sort(
    (a, b) => Number(b.data("inDegree") ?? 0) - Number(a.data("inDegree") ?? 0)
  );
  const count = Math.max(1, Math.ceil((percent / 100) * sorted.length));
  const selected = sorted.slice(0, count);

  const context = new Set<string>();
  selected.forEach((node: any) => {
    context.add(node.id());
    node.connectedEdges().forEach((edge: any) => {
      context.add(edge.source().id());
      context.add(edge.target().id());
    });
  });
  return context;
}

function getNeighborhood(nodeId: string, hops: number): Set<string> {
  const center = cy.getElementById(nodeId);
  if (center.empty()) return new Set();

  const visited = new Set<string>([nodeId]);
  let frontier = new Set<string>([nodeId]);

  for (let depth = 0; depth < hops; depth += 1) {
    const next = new Set<string>();
    frontier.forEach(id => {
      const node = cy.getElementById(id);
      node.connectedEdges().forEach(edge => {
        const sourceId = edge.source().id();
        const targetId = edge.target().id();
        if (!visited.has(sourceId)) {
          visited.add(sourceId);
          next.add(sourceId);
        }
        if (!visited.has(targetId)) {
          visited.add(targetId);
          next.add(targetId);
        }
      });
    });
    if (next.size === 0) break;
    frontier = next;
  }

  return visited;
}

function getOrphanModuleIds(): Set<string> {
  const orphanIds = new Set<string>();
  cy
    .$("node")
    .filter(node => !node.hasClass("twinkle-star") && node.data("category") === "source")
    .forEach(node => {
      const inDegree = Number(node.data("inDegree") ?? 0);
      const outDegree = Number(node.data("outDegree") ?? 0);
      if (inDegree === 0 && outDegree === 0) {
        orphanIds.add(node.id());
      }
    });
  return orphanIds;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, ratio));
  const index = Math.min(sorted.length - 1, Math.floor(clamped * (sorted.length - 1)));
  return sorted[index];
}

function getGodFileIds(): Set<string> {
  const sourceNodes = cy
    .$("node")
    .filter(node => !node.hasClass("twinkle-star") && node.data("category") === "source")
    .toArray();

  if (sourceNodes.length === 0) return new Set<string>();

  const locValues = sourceNodes.map(node => Number(node.data("loc") ?? 0));
  const inDegreeValues = sourceNodes.map(node => Number(node.data("inDegree") ?? 0));
  const outDegreeValues = sourceNodes.map(node => Number(node.data("outDegree") ?? 0));

  const locThreshold = percentile(locValues, 0.85);
  const inDegreeThreshold = percentile(inDegreeValues, 0.85);
  const outDegreeThreshold = percentile(outDegreeValues, 0.85);

  const godIds = new Set<string>();
  sourceNodes.forEach(node => {
    const loc = Number(node.data("loc") ?? 0);
    const inDegree = Number(node.data("inDegree") ?? 0);
    const outDegree = Number(node.data("outDegree") ?? 0);
    const hasHighLoc = loc >= locThreshold;
    const hasHighCoupling = inDegree >= inDegreeThreshold || outDegree >= outDegreeThreshold;
    if (hasHighLoc && hasHighCoupling) {
      godIds.add(node.id());
    }
  });

  return godIds;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildHeuristicSummary(nodeId: string): string {
  const node = cy.getElementById(nodeId);
  if (node.empty()) return "No node available.";

  const category = String(node.data("category") ?? "source");
  const inDegree = Number(node.data("inDegree") ?? 0);
  const outDegree = Number(node.data("outDegree") ?? 0);
  const riskScore = Number(node.data("riskScore") ?? 0);

  if (category === "external") {
    const importerCount = node.incomers("edge").length;
    return `External package imported by ${importerCount} file(s). This dependency currently has ${inDegree} incoming edge(s) and ${outDegree} outgoing edge(s) in the map.`;
  }

  const outgoingEdges = node.outgoers("edge").toArray();
  const dynamicCount = outgoingEdges.filter(edge => edge.data("type") === "dynamic-import").length;
  const externalCount = outgoingEdges.filter(edge => edge.data("scope") === "external").length;
  const internalCount = outgoingEdges.filter(edge => edge.data("scope") === "internal").length;

  const riskBand = riskScore >= 9 ? "high" : riskScore >= 6 ? "medium" : "lower";
  const couplingSignal = inDegree >= 6
    ? "heavily depended on"
    : inDegree >= 3
      ? "moderately depended on"
      : "lightly depended on";

  return [
    `This ${node.data("ext") || "source"} module is ${couplingSignal} by other files and currently has ${riskBand} architectural risk (score ${riskScore.toFixed(2)}).`,
    `Outgoing dependencies: ${outDegree} total (${internalCount} internal, ${externalCount} external, ${dynamicCount} dynamic).`,
    `Use neighborhood focus to inspect nearby impact and incoming/outgoing direction filters to inspect responsibility boundaries.`
  ].join(" ");
}

async function requestLlmSummary(nodeId: string): Promise<string | null> {
  const node = cy.getElementById(nodeId);
  if (node.empty()) return null;

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

  const controller = new AbortController();
  const timerId = window.setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

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
      }),
      signal: controller.signal
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { description?: string };
    if (!data.description || data.description.trim().length === 0) return null;
    return data.description.trim();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timerId);
  }
}

async function populateNodeExplanation(nodeId: string, requestId: number): Promise<void> {
  const llmSummary = await requestLlmSummary(nodeId);
  const target = detailsPanel.querySelector(
    `#llm-explanation[data-request-id=\"${requestId}\"]`
  ) as HTMLParagraphElement | null;

  if (!target || requestId !== detailsRequestCounter) return;
  target.textContent = llmSummary
    ? llmSummary
    : "LLM provider unavailable. Heuristic summary above is being used instead.";
}

const EMPTY_GRAPH: GraphData = {
  nodes: [],
  edges: [],
  unresolvedImports: []
};

function updateEmptyStatePrompt(isEmpty: boolean): void {
  emptyStatePrompt.classList.toggle("hidden", !isEmpty);
}

let cy = createViewer({
  container,
  graph: EMPTY_GRAPH,
  onNodeSelect: renderDetails
});
let currentGraphData: GraphData = EMPTY_GRAPH;
let cySecondary: ReturnType<typeof createViewer> | null = null;

async function runExport(task: () => void | Promise<void>, successMessage: string): Promise<void> {
  try {
    await task();
    setStatus(successMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown export error";
    setStatus(`Export failed: ${message}`);
  }
}

let currentGraph: GraphData = EMPTY_GRAPH;
let lastSearchMatches: Set<string> = new Set();
let graphDerivedDataDirty = true;
let cachedOrphanIds: Set<string> = new Set();
let cachedGodFileIds: Set<string> = new Set();

function markGraphDerivedDataDirty(): void {
  graphDerivedDataDirty = true;
}

function ensureGraphDerivedData(): void {
  if (!graphDerivedDataDirty) return;
  cachedOrphanIds = getOrphanModuleIds();
  cachedGodFileIds = getGodFileIds();
  graphDerivedDataDirty = false;
}

function applyFilters(options: { fit?: boolean } = {}): { visibleCount: number; matchedSearchCount: number; matchedAdvancedCount: number } {
  const { fit = false } = options;

  const nodes = cy.nodes().filter(node => !node.hasClass("twinkle-star"));
  const edges = cy.edges();

  ensureGraphDerivedData();
  const orphanIds = cachedOrphanIds;
  const godFileIds = cachedGodFileIds;

  cy.batch(() => {
    nodes.removeClass("dimmed focus-primary focus-secondary orphan-node god-file-node");
    edges.removeClass("dimmed edge-incoming edge-outgoing");

    nodes.forEach(node => {
      if (orphanIds.has(node.id())) node.addClass("orphan-node");
      if (filterState.highlightGodFiles && godFileIds.has(node.id())) node.addClass("god-file-node");
    });
  });

  let visibleNodeIds = new Set(nodes.map(node => node.id()));
  let matchedSearchCount = 0;
  let matchedAdvancedCount = 0;

  if (filterState.searchQuery) {
    const matches = nodes.filter(node => {
      const path = String(node.data("path") ?? node.id());
      return matchesQuery(path, filterState.searchQuery);
    });

    matchedSearchCount = matches.length;
    lastSearchMatches = new Set(matches.map(m => m.id())); // Track matched nodes for focused fit
    const searchContext = new Set<string>();
    matches.forEach(node => {
      searchContext.add(node.id());
      node.connectedEdges().forEach(edge => {
        searchContext.add(edge.source().id());
        searchContext.add(edge.target().id());
      });
    });
    visibleNodeIds = intersects(visibleNodeIds, searchContext);
  }

  // Semantic/Advanced search filter
  if (filterState.advancedQuery) {
    const semanticMatches = nodes.filter(node => {
      const path = String(node.data("path") ?? node.id());
      return matchesSemanticQuery(path, filterState.advancedQuery);
    });

    matchedAdvancedCount = semanticMatches.length;
    const semanticContext = new Set<string>();
    semanticMatches.forEach(node => {
      semanticContext.add(node.id());
      node.connectedEdges().forEach(edge => {
        semanticContext.add(edge.source().id());
        semanticContext.add(edge.target().id());
      });
    });
    visibleNodeIds = intersects(visibleNodeIds, semanticContext);
  }

  // Risk score filter
  if (filterState.minRiskScore > 0) {
    const riskMatches = new Set<string>();
    nodes.forEach(node => {
      const riskScore = Number(node.data("riskScore") ?? 0);
      if (riskScore >= filterState.minRiskScore) {
        riskMatches.add(node.id());
      }
    });
    visibleNodeIds = intersects(visibleNodeIds, riskMatches);
  }

  if (filterState.topDependedPercent < 100) {
    const topContext = getTopDependedNodeContext(filterState.topDependedPercent);
    visibleNodeIds = intersects(visibleNodeIds, topContext);
  }

  if (filterState.showOrphanModulesOnly) {
    visibleNodeIds = intersects(visibleNodeIds, orphanIds);
  }

  if (currentSelectedNodeId && filterState.neighborhoodHops > 0) {
    const neighborhood = getNeighborhood(currentSelectedNodeId, filterState.neighborhoodHops);
    visibleNodeIds = intersects(visibleNodeIds, neighborhood);
  }

  if (currentSelectedNodeId) {
    visibleNodeIds.add(currentSelectedNodeId);
  }

  const visibleEdgeIds = new Set<string>();
  edges.forEach(edge => {
    const sourceId = edge.source().id();
    const targetId = edge.target().id();
    if (!visibleNodeIds.has(sourceId) || !visibleNodeIds.has(targetId)) return;

    const edgeType = String(edge.data("type"));
    const edgeScope = String(edge.data("scope"));

    if (edgeType === "import" && !filterState.showStaticEdges) return;
    if (edgeType === "dynamic-import" && !filterState.showDynamicEdges) return;
    if (edgeScope === "internal" && !filterState.showInternalEdges) return;
    if (edgeScope === "external" && !filterState.showExternalEdges) return;

    if (currentSelectedNodeId && filterState.edgeDirection !== "all") {
      const selected = currentSelectedNodeId;
      if (filterState.edgeDirection === "incoming" && targetId !== selected) return;
      if (filterState.edgeDirection === "outgoing" && sourceId !== selected) return;
    }

    visibleEdgeIds.add(edge.id());
  });

  cy.batch(() => {
    nodes.forEach(node => {
      if (!visibleNodeIds.has(node.id())) {
        node.addClass("dimmed");
      }
    });

    edges.forEach(edge => {
      if (!visibleEdgeIds.has(edge.id())) {
        edge.addClass("dimmed");
      }
    });

    if (currentSelectedNodeId) {
      const selected = cy.getElementById(currentSelectedNodeId);
      if (!selected.empty()) {
        selected.removeClass("dimmed");
        selected.addClass("focus-primary");

        if (filterState.neighborhoodHops > 0) {
          const neighborhood = getNeighborhood(currentSelectedNodeId, filterState.neighborhoodHops);
          neighborhood.forEach(id => {
            if (id === currentSelectedNodeId) return;
            if (!visibleNodeIds.has(id)) return;
            const node = cy.getElementById(id);
            if (!node.empty()) node.addClass("focus-secondary");
          });
        }

        selected.incomers("edge").forEach(edge => {
          if (visibleEdgeIds.has(edge.id())) edge.addClass("edge-incoming");
        });
        selected.outgoers("edge").forEach(edge => {
          if (visibleEdgeIds.has(edge.id())) edge.addClass("edge-outgoing");
        });
      }
    }
  });

  const visibleNodes = nodes.filter(node => !node.hasClass("dimmed"));
  
  // If fitting and we have specific search matches, fit to just the matched nodes for better focus
  if (fit && matchedSearchCount > 0) {
    const matchedNodes = nodes.filter(node => lastSearchMatches.has(node.id()));
    if (matchedNodes.length > 0) {
      // Use a tighter padding for focused view
      cy.fit(matchedNodes, 40);
    }
  } else if (fit && visibleNodes.length > 0) {
    cy.fit(visibleNodes, 80);
  }

  return { visibleCount: visibleNodes.length, matchedSearchCount, matchedAdvancedCount };
}

function resetAllFilters(): void {
  // Reset all filter state to defaults
  filterState.searchQuery = "";
  filterState.advancedQuery = "";
  filterState.useSemanticSearch = false;
  filterState.topDependedPercent = 100;
  filterState.neighborhoodHops = 1;
  filterState.edgeDirection = "all";
  filterState.showStaticEdges = true;
  filterState.showDynamicEdges = true;
  filterState.showInternalEdges = true;
  filterState.showExternalEdges = true;
  filterState.showOrphanModulesOnly = false;
  filterState.highlightGodFiles = false;
  filterState.scalabilityMode = true;
  filterState.clusteringMode = "directory";
  filterState.minRiskScore = 0;

  // Reset UI controls
  searchInput.value = "";
  advancedQueryInput.value = "";
  topDependedRange.value = "100";
  neighborhoodSelect.value = "1";
  edgeDirectionSelect.value = "all";
  toggleStaticEdges.checked = true;
  toggleDynamicEdges.checked = true;
  toggleInternalEdges.checked = true;
  toggleExternalEdges.checked = true;
  toggleOrphanModules.checked = false;
  toggleGodFiles.checked = false;
  toggleScalabilityMode.checked = true;
  toggleClusteringMode.checked = false;
  riskFilterRange.value = "0";

  // Reset tracking variables
  currentSelectedNodeId = null;
  lastSearchMatches.clear();

  // Update labels
  formatTopDependedLabel(filterState.topDependedPercent);
  formatRiskFilterLabel(filterState.minRiskScore);
  setArchitectureChecksStatus("Architecture checks inactive.");

  // Clear selection and apply filters
  cy.nodes().unselect();
  applyFilters();
  renderDetails(null, { applyGraphFilters: false });

  setStatus("All filters reset to defaults.");
}


function renderDetails(nodeId: string | null, options: { applyGraphFilters?: boolean } = {}): void {
  const { applyGraphFilters = true } = options;
  currentSelectedNodeId = nodeId;
  cy.nodes().unselect();
  if (nodeId) {
    const selected = cy.getElementById(nodeId);
    if (!selected.empty()) {
      selected.select();
    }
  }
  if (applyGraphFilters) {
    applyFilters();
  }

  const requestId = ++detailsRequestCounter;
  if (!nodeId) {
    detailsPanel.innerHTML = "<p>Select a node to inspect details.</p>";
    return;
  }

  const node = cy.getElementById(nodeId);
  if (node.empty()) return;

  const category = String(node.data("category") ?? "source");
  const heuristicSummary = buildHeuristicSummary(nodeId);
  const llmSection = toggleLlmSummary.checked
    ? `<p><strong>Optional LLM Summary:</strong></p>
       <p id="llm-explanation" data-request-id="${requestId}">Loading from local server...</p>`
    : "<p><strong>Optional LLM Summary:</strong> Disabled. Running fully local without model.</p>";

  const isOrphan = Number(node.data("inDegree") ?? 0) === 0 && Number(node.data("outDegree") ?? 0) === 0;
  ensureGraphDerivedData();
  const isGodFile = cachedGodFileIds.has(nodeId);

  detailsPanel.innerHTML = `
    <h4>${escapeHtml(String(node.data("label") ?? nodeId))}</h4>
    <p><strong>Path:</strong> ${escapeHtml(String(node.data("path") ?? nodeId))}</p>
    <p><strong>Directory:</strong> ${escapeHtml(String(node.data("dir") ?? "(unknown)"))}</p>
    <p><strong>Type:</strong> ${escapeHtml(category)}</p>
    <p><strong>Ext:</strong> ${escapeHtml(String(node.data("ext") || "(none)"))}</p>
    <p><strong>LOC:</strong> ${Number(node.data("loc") ?? 0)}</p>
    <p><strong>Size:</strong> ${Number(node.data("sizeBytes") ?? 0)} bytes</p>
    <p><strong>In/Out:</strong> ${Number(node.data("inDegree") ?? 0)} / ${Number(node.data("outDegree") ?? 0)}</p>
    <p><strong>Risk:</strong> ${Number(node.data("riskScore") ?? 0).toFixed(2)}</p>
    <p><strong>Orphan Module:</strong> ${isOrphan ? "Yes" : "No"}</p>
    <p><strong>God File Heuristic:</strong> ${isGodFile ? "Flagged" : "Not flagged"}</p>
    <p><strong>Heuristic Summary:</strong></p>
    <p>${escapeHtml(heuristicSummary)}</p>
    ${llmSection}
  `;

  if (toggleLlmSummary.checked) {
    void populateNodeExplanation(nodeId, requestId);
  }
}

function reloadViewer(nextGraph: GraphData): void {
  if (cySecondary) {
    cySecondary.destroy();
    cySecondary = null;
  }
  setSideBySideMode(false);
  paneBeforeLabel.textContent = "Current view";
  paneAfterLabel.textContent = "After";
  currentGraphData = nextGraph;
  cy.destroy();
  currentSelectedNodeId = null;
  detailsRequestCounter += 1;
  currentGraph = nextGraph;
  markGraphDerivedDataDirty();
  updateEmptyStatePrompt(nextGraph.nodes.length === 0);
  cy = createViewer({
    container,
    graph: nextGraph,
    onNodeSelect: renderDetails,
    clusteringMode: filterState.clusteringMode,
    progressiveRender: filterState.scalabilityMode,
    onReady: () => {
      applyFilters();
      renderDetails(null, { applyGraphFilters: false });
      playGalaxyEntryAnimation();
    }
  });
}

sampleButton.addEventListener("click", () => {
  setViewMode("single");
  reloadViewer(normalizeSampleGraph(graph));
  setStatus("Loaded sample graph.");
});

exportButton.addEventListener("click", () => {
  const format = exportFormatSelect.value;
  if (format === "png") {
    void runExport(() => exportGraphPng(cy), "Exported PNG snapshot.");
    return;
  }
  if (format === "pdf") {
    void runExport(() => exportPdfReport(currentGraphData, cy), "Exported PDF report.");
    return;
  }
  if (format === "json") {
    void runExport(() => exportMetricsJson(currentGraphData), "Exported JSON metrics.");
    return;
  }
  if (format === "csv") {
    void runExport(() => exportMetricsCsv(currentGraphData), "Exported CSV metrics.");
    return;
  }
  if (format === "risk") {
    void runExport(() => exportArchitectureRiskTxt(currentGraphData), "Exported architecture risk report.");
    return;
  }
  setStatus("Choose an export format first.");
});

fileInput.addEventListener("change", async event => {
  setViewMode("single");
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  setAnalysisLoadingState(true);
  setStatus(`Analyzing ${file.name}...`);
  try {
    const zipBuffer = await file.arrayBuffer();
    const analyzed = await analyzeZipBuffer(zipBuffer, file.name);
    reloadViewer(analyzed);
    setStatus(
      `Loaded ${analyzed.nodes.length} nodes, ${analyzed.edges.length} edges. ` +
      `Unresolved relative imports: ${analyzed.unresolvedImports.length}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Failed to analyze zip: ${message}`);
  } finally {
    setAnalysisLoadingState(false);
  }
});

loadGithubRepoButton.addEventListener("click", async () => {
  setViewMode("single");
  const rawInput = githubRepoInput.value.trim();
  if (!rawInput) {
    setStatus("Enter a GitHub URL (or owner/repo) first.");
    return;
  }

  setGithubLoadingState(true);
  setAnalysisLoadingState(true);
  try {
    const parsed = parseGitHubRepoInput(rawInput);
    setStatus(`Downloading ${parsed.owner}/${parsed.repo} from GitHub...`);
    const { zipBuffer, resolvedRef } = await downloadGitHubZip(parsed);
    const analyzed = await analyzeZipBuffer(zipBuffer, `${parsed.owner}/${parsed.repo}@${resolvedRef}`);
    reloadViewer(analyzed);
    setStatus(
      `Loaded ${analyzed.nodes.length} nodes, ${analyzed.edges.length} edges from ${parsed.owner}/${parsed.repo}@${resolvedRef}. ` +
      `Unresolved relative imports: ${analyzed.unresolvedImports.length}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Failed to load GitHub repo: ${message}`);
  } finally {
    setAnalysisLoadingState(false);
    setGithubLoadingState(false);
  }
});

compareRepoButton.addEventListener("click", async () => {
  setViewMode("comparison");
  const rawInput = compareRepoInput.value.trim();
  if (!rawInput) {
    setStatus("Enter a GitHub URL (or owner/repo) for before/after comparison.");
    return;
  }

  const beforeRef = compareBeforeRefInput.value.trim();
  const afterRef = compareAfterRefInput.value.trim();
  if (!beforeRef || !afterRef) {
    setStatus("Enter both before and after refs.");
    return;
  }

  setComparisonLoadingState(true);
  try {
    const parsed = parseGitHubRepoInput(rawInput);
    setStatus(`Downloading ${parsed.owner}/${parsed.repo}@${beforeRef} and @${afterRef}...`);
    const [beforeZip, afterZip] = await Promise.all([
      downloadGitHubZip({ owner: parsed.owner, repo: parsed.repo, ref: beforeRef }),
      downloadGitHubZip({ owner: parsed.owner, repo: parsed.repo, ref: afterRef })
    ]);

    setStatus(`Analyzing before/after snapshots for ${parsed.owner}/${parsed.repo}...`);
    const [beforeGraph, afterGraph] = await Promise.all([
      createGraphFromZipBuffer(beforeZip.zipBuffer),
      createGraphFromZipBuffer(afterZip.zipBuffer)
    ]);

    const summary = renderComparisonView(
      beforeGraph,
      afterGraph,
      `${parsed.owner}/${parsed.repo}@${beforeZip.resolvedRef}`,
      `${parsed.owner}/${parsed.repo}@${afterZip.resolvedRef}`
    );
    setStatus(
      `Compared ${parsed.owner}/${parsed.repo}: ${beforeZip.resolvedRef} -> ${afterZip.resolvedRef}. ` +
      `Shared ${summary.sharedNodes}/${summary.beforeNodes} nodes, removed ${summary.removedNodes}; ` +
      `shared ${summary.sharedEdges}/${summary.beforeEdges} edges, added ${Math.max(0, summary.afterEdges - summary.sharedEdges)}.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Failed to compare repo refs: ${message}`);
  } finally {
    setComparisonLoadingState(false);
  }
});

compareZipButton.addEventListener("click", async () => {
  setViewMode("comparison");
  const beforeZip = compareBeforeZipInput.files?.[0];
  const afterZip = compareAfterZipInput.files?.[0];
  if (!beforeZip || !afterZip) {
    setStatus("Choose both before and after zip files.");
    return;
  }

  setComparisonLoadingState(true);
  try {
    setStatus(`Analyzing before/after zip files (${beforeZip.name}, ${afterZip.name})...`);
    const [beforeGraph, afterGraph] = await Promise.all([
      createGraphFromZip(beforeZip),
      createGraphFromZip(afterZip)
    ]);

    const summary = renderComparisonView(beforeGraph, afterGraph, beforeZip.name, afterZip.name);
    setStatus(
      `Compared zip files: ${beforeZip.name} -> ${afterZip.name}. ` +
      `Shared ${summary.sharedNodes}/${summary.beforeNodes} nodes, removed ${summary.removedNodes}; ` +
      `shared ${summary.sharedEdges}/${summary.beforeEdges} edges, added ${Math.max(0, summary.afterEdges - summary.sharedEdges)}.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Failed to compare zip files: ${message}`);
  } finally {
    setComparisonLoadingState(false);
  }
});

githubRepoInput.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  loadGithubRepoButton.click();
});

compareRepoInput.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  compareRepoButton.click();
});

viewModeSelect.addEventListener("change", () => {
  const mode: ViewMode = viewModeSelect.value === "comparison" ? "comparison" : "single";
  setViewMode(mode);
  setStatus(
    mode === "comparison"
      ? "Comparison mode enabled. Choose before and after snapshots."
      : "Single mode enabled. Load one snapshot."
  );
});

focusButton.addEventListener("click", () => {
  filterState.searchQuery = searchInput.value.trim();
  
  if (!filterState.searchQuery) {
    lastSearchMatches.clear();
    applyFilters();
    setStatus("Search cleared. Active filters still applied.");
    return;
  }
  
  const result = applyFilters({ fit: true });

  if (result.matchedSearchCount > 0) {
    setStatus(`Focused ${result.matchedSearchCount} matched node(s) for "${filterState.searchQuery}". Dimmed nodes shown for context.`);
  } else {
    setStatus(`No files matched "${filterState.searchQuery}". Try filename-only like "userService".`);
  }
});

searchInput.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  focusButton.click();
});

resetFiltersButton.addEventListener("click", () => {
  resetAllFilters();
});

topDependedRange.addEventListener("input", () => {
  filterState.topDependedPercent = Number(topDependedRange.value);
  formatTopDependedLabel(filterState.topDependedPercent);
  const result = applyFilters();
  setStatus(`Showing ${result.visibleCount} visible node(s) with top ${filterState.topDependedPercent}% in-degree filter.`);
});

neighborhoodSelect.addEventListener("change", () => {
  filterState.neighborhoodHops = Number(neighborhoodSelect.value);
  const result = applyFilters();
  setStatus(`Neighborhood filter set to ${filterState.neighborhoodHops} hop(s). Visible nodes: ${result.visibleCount}.`);
});

edgeDirectionSelect.addEventListener("change", () => {
  filterState.edgeDirection = edgeDirectionSelect.value as EdgeDirection;
  const result = applyFilters();
  if (!currentSelectedNodeId && filterState.edgeDirection !== "all") {
    setStatus("Select a node to apply incoming/outgoing direction filtering.");
    return;
  }
  setStatus(`Edge direction mode: ${filterState.edgeDirection}. Visible nodes: ${result.visibleCount}.`);
});

function clampDependencyToggleAtLeastOne(): void {
  if (toggleStaticEdges.checked || toggleDynamicEdges.checked) return;
  toggleStaticEdges.checked = true;
}

function clampScopeToggleAtLeastOne(): void {
  if (toggleInternalEdges.checked || toggleExternalEdges.checked) return;
  toggleInternalEdges.checked = true;
}

function applySemanticToggleStatus(): void {
  filterState.showStaticEdges = toggleStaticEdges.checked;
  filterState.showDynamicEdges = toggleDynamicEdges.checked;
  filterState.showInternalEdges = toggleInternalEdges.checked;
  filterState.showExternalEdges = toggleExternalEdges.checked;

  const result = applyFilters();
  setStatus(`Dependency semantics filters updated. Visible nodes: ${result.visibleCount}.`);
}

toggleStaticEdges.addEventListener("change", () => {
  clampDependencyToggleAtLeastOne();
  applySemanticToggleStatus();
});

toggleDynamicEdges.addEventListener("change", () => {
  clampDependencyToggleAtLeastOne();
  applySemanticToggleStatus();
});

toggleInternalEdges.addEventListener("change", () => {
  clampScopeToggleAtLeastOne();
  applySemanticToggleStatus();
});

toggleExternalEdges.addEventListener("change", () => {
  clampScopeToggleAtLeastOne();
  applySemanticToggleStatus();
});

toggleScalabilityMode.addEventListener("change", () => {
  filterState.scalabilityMode = toggleScalabilityMode.checked;
  setStatus(
    filterState.scalabilityMode
      ? "Scalability mode enabled. Rendering uses progressive batches for large graphs."
      : "Scalability mode disabled. Rendering uses full draw mode."
  );
});

toggleOrphanModules.addEventListener("change", () => {
  filterState.showOrphanModulesOnly = toggleOrphanModules.checked;
  const result = applyFilters();
  setArchitectureChecksStatus(
    filterState.showOrphanModulesOnly
      ? `Orphan-module check enabled. Visible nodes: ${result.visibleCount}.`
      : `Orphan-module check disabled. Visible nodes: ${result.visibleCount}.`
  );
});

toggleGodFiles.addEventListener("change", () => {
  filterState.highlightGodFiles = toggleGodFiles.checked;
  const result = applyFilters();
  setArchitectureChecksStatus(
    filterState.highlightGodFiles
      ? `God-file heuristic highlighting enabled. Visible nodes: ${result.visibleCount}.`
      : `God-file heuristic highlighting disabled. Visible nodes: ${result.visibleCount}.`
  );
});

toggleLlmSummary.addEventListener("change", () => {
  if (currentSelectedNodeId) {
    renderDetails(currentSelectedNodeId, { applyGraphFilters: false });
  }
  if (!toggleLlmSummary.checked) {
    setStatus("LLM summary disabled. Using local heuristic summaries only.");
    return;
  }
  setStatus("LLM summary enabled. The app will gracefully fall back if the provider is unavailable.");
});

toggleClusteringMode.addEventListener("change", () => {
  filterState.clusteringMode = toggleClusteringMode.checked ? "community" : "directory";
  reloadViewer(currentGraph);
  const modeLabel = filterState.clusteringMode === "community" ? "dependency communities" : "directory structure";
  setStatus(`Clustering mode changed to: ${modeLabel}.`);
});

function formatRiskFilterLabel(threshold: number): void {
  if (threshold <= 0) {
    riskFilterValue.textContent = "Showing all risk levels.";
  } else {
    riskFilterValue.textContent = `Showing files with risk score ≥ ${threshold.toFixed(1)}.`;
  }
}

riskFilterRange.addEventListener("input", () => {
  filterState.minRiskScore = Number(riskFilterRange.value);
  formatRiskFilterLabel(filterState.minRiskScore);
  const result = applyFilters();
  setStatus(`Risk score filter set to ≥ ${filterState.minRiskScore.toFixed(1)}. Visible nodes: ${result.visibleCount}.`);
});

advancedSearchButton.addEventListener("click", () => {
  filterState.advancedQuery = advancedQueryInput.value.trim();
  const result = applyFilters({ fit: true });

  if (!filterState.advancedQuery) {
    setStatus("Advanced semantic search cleared.");
    return;
  }

  if (result.matchedAdvancedCount > 0) {
    setStatus(`Semantic search matched ${result.matchedAdvancedCount} node(s) for "${filterState.advancedQuery}". Visible nodes: ${result.visibleCount}.`);
  } else {
    setStatus(`No results for semantic query "${filterState.advancedQuery}". Try: auth-logic, database-layer, api-endpoints, ui-components, testing`);
  }
});

advancedQueryInput.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  advancedSearchButton.click();
});

formatTopDependedLabel(filterState.topDependedPercent);
setViewMode("single");
formatRiskFilterLabel(filterState.minRiskScore);
toggleScalabilityMode.checked = filterState.scalabilityMode;
applyFilters();
renderDetails(null, { applyGraphFilters: false });
updateEmptyStatePrompt(true);
setStatus("Upload a repo zip, add a GitHub link, or load the sample project to begin.");
playGalaxyEntryAnimation();
