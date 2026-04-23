import type { Core } from "cytoscape";
import { jsPDF } from "jspdf";
import type { GraphData } from "./types";

interface SummaryMetrics {
  totalNodes: number;
  sourceNodes: number;
  externalNodes: number;
  totalEdges: number;
  internalEdges: number;
  externalEdges: number;
  dynamicEdges: number;
  unresolvedImports: number;
  avgRiskScore: number;
}

interface RiskNodeRow {
  path: string;
  riskScore: number;
  inDegree: number;
  outDegree: number;
  sizeBytes: number;
  loc: number;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function safeNumber(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function buildSummaryMetrics(graph: GraphData): SummaryMetrics {
  const sourceNodes = graph.nodes.filter(node => node.category === "source");
  const externalNodes = graph.nodes.filter(node => node.category === "external");
  const internalEdges = graph.edges.filter(edge => edge.scope === "internal");
  const externalEdges = graph.edges.filter(edge => edge.scope === "external");
  const dynamicEdges = graph.edges.filter(edge => edge.type === "dynamic-import");
  const avgRisk = sourceNodes.length > 0
    ? sourceNodes.reduce((sum, node) => sum + node.riskScore, 0) / sourceNodes.length
    : 0;

  return {
    totalNodes: graph.nodes.length,
    sourceNodes: sourceNodes.length,
    externalNodes: externalNodes.length,
    totalEdges: graph.edges.length,
    internalEdges: internalEdges.length,
    externalEdges: externalEdges.length,
    dynamicEdges: dynamicEdges.length,
    unresolvedImports: graph.unresolvedImports.length,
    avgRiskScore: safeNumber(avgRisk)
  };
}

function topRiskRows(graph: GraphData, limit = 10): RiskNodeRow[] {
  return graph.nodes
    .filter(node => node.category === "source")
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, limit)
    .map(node => ({
      path: node.path,
      riskScore: safeNumber(node.riskScore),
      inDegree: node.inDegree,
      outDegree: node.outDegree,
      sizeBytes: node.sizeBytes,
      loc: node.loc
    }));
}

function csvEscape(value: string | number): string {
  const text = String(value);
  if (text.includes(",") || text.includes("\n") || text.includes("\"")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

function toCsv(rows: Array<Record<string, string | number>>, headers: string[]): string {
  const headerLine = headers.join(",");
  const lines = rows.map(row => headers.map(header => csvEscape(row[header] ?? "")).join(","));
  return [headerLine, ...lines].join("\n");
}

function architectureRiskReport(graph: GraphData): string {
  const summary = buildSummaryMetrics(graph);
  const topRisk = topRiskRows(graph, 5);
  const dependencyPressure = summary.totalEdges > 0
    ? safeNumber((summary.externalEdges / summary.totalEdges) * 100)
    : 0;

  const lines: string[] = [
    "Architecture Risk Report",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Overview",
    `- Total nodes: ${summary.totalNodes} (${summary.sourceNodes} source, ${summary.externalNodes} external)`,
    `- Total edges: ${summary.totalEdges} (${summary.internalEdges} internal, ${summary.externalEdges} external)`,
    `- Dynamic imports: ${summary.dynamicEdges}`,
    `- Average risk score: ${summary.avgRiskScore}`,
    `- External dependency pressure: ${dependencyPressure}%`,
    `- Unresolved imports: ${summary.unresolvedImports}`,
    "",
    "Top Risk Files"
  ];

  topRisk.forEach((row, index) => {
    lines.push(
      `${index + 1}. ${row.path} | risk=${row.riskScore}, in=${row.inDegree}, out=${row.outDegree}, loc=${row.loc}`
    );
  });

  if (topRisk.length === 0) {
    lines.push("No source files found.");
  }

  lines.push("", "Suggested Actions");
  lines.push("1. Review top in-degree files first; they are high-impact change points.");
  lines.push("2. Reduce external dependency pressure where possible.");
  lines.push("3. Address unresolved imports to improve graph accuracy.");

  return lines.join("\n");
}

function baseReportPayload(graph: GraphData): {
  generatedAt: string;
  summary: SummaryMetrics;
  topRiskFiles: RiskNodeRow[];
  unresolvedImports: string[];
} {
  return {
    generatedAt: new Date().toISOString(),
    summary: buildSummaryMetrics(graph),
    topRiskFiles: topRiskRows(graph),
    unresolvedImports: [...graph.unresolvedImports].sort()
  };
}

export function exportMetricsJson(graph: GraphData): void {
  const payload = baseReportPayload(graph);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  triggerDownload(blob, "codebase-metrics.json");
}

export function exportMetricsCsv(graph: GraphData): void {
  const summary = buildSummaryMetrics(graph);
  const rows = graph.nodes
    .filter(node => node.category === "source")
    .sort((a, b) => b.riskScore - a.riskScore)
    .map(node => ({
      path: node.path,
      riskScore: safeNumber(node.riskScore),
      inDegree: node.inDegree,
      outDegree: node.outDegree,
      sizeBytes: node.sizeBytes,
      loc: node.loc,
      totalNodes: summary.totalNodes,
      totalEdges: summary.totalEdges,
      unresolvedImports: summary.unresolvedImports
    }));

  const csv = toCsv(rows, [
    "path",
    "riskScore",
    "inDegree",
    "outDegree",
    "sizeBytes",
    "loc",
    "totalNodes",
    "totalEdges",
    "unresolvedImports"
  ]);

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, "codebase-metrics.csv");
}

export function exportArchitectureRiskTxt(graph: GraphData): void {
  const report = architectureRiskReport(graph);
  const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, "architecture-risk-report.txt");
}

export function exportGraphPng(cy: Core): void {
  const dataUrl = cy.png({ full: true, scale: 2, bg: "#0b0f26" });
  const response = fetch(dataUrl)
    .then(res => res.blob())
    .then(blob => triggerDownload(blob, "codebase-map-snapshot.png"));
  void response;
}

export function exportPdfReport(graph: GraphData, cy: Core): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const report = architectureRiskReport(graph);
  const lines = doc.splitTextToSize(report, 520);

  doc.setFontSize(16);
  doc.text("Codebase Export Report", 40, 40);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toISOString()}`, 40, 58);

  const imageData = cy.png({ full: true, scale: 1.5, bg: "#0b0f26" });
  doc.addImage(imageData, "PNG", 40, 78, 515, 220);

  doc.setFontSize(9);
  doc.text(lines, 40, 320);
  doc.save("codebase-report.pdf");
}
