import cytoscape from "cytoscape";
import graph from "./graph.json";
import "./style.css";

// Configuration
const DEEPWIKI_API_URL = "http://localhost:8001";
const REPO_URL = graph.repo_url || "https://github.com/AsyncFuncAI/deepwiki-open";
const REPO_TYPE = graph.repo_type || "github";

const elements = [
  ...graph.nodes.map(node => ({
    data: { id: node.id, dir: node.dir }
  })),
  ...graph.edges.map(edge => ({
    data: { source: edge.source, target: edge.target }
  }))
];

// Simple color map by directory
const dirColors: Record<string, string> = {
  core: "#1f77b4",
  services: "#2ca02c",
  infra: "#d62728",
  utils: "#9467bd"
};

const cy = cytoscape({
  container: document.getElementById("cy"),

  elements,

  style: [
    {
      selector: "node",
      style: {
        label: "data(id)",
        "background-color": ele => dirColors[ele.data("dir")] || "#999",
        "text-valign": "center",
        color: "#fff",
        "font-size": 10
      }
    },
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": "#ccc",
        "target-arrow-color": "#ccc",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier"
      }
    }
  ],
  

  layout: {
    name: "cose",
    animate: true
  }
});

  // Store full node data for details panel
  cy.nodes().forEach((cyNode) => {
    const nodeId = cyNode.data("id");
    const nodeData = graph.nodes.find(n => n.id === nodeId);
    if (nodeData) {
      cyNode.data("nodeInfo", nodeData);
    }
  });

cy.on('tap', 'node', async (evt) => {
  const node = evt.target;
  const nodeInfo = node.data('nodeInfo');
  const nodeId = node.data('id');
  
  // Calculate dependencies
  const outgoing = cy.edges(`[source = "${nodeId}"]`).length;
  const incoming = cy.edges(`[target = "${nodeId}"]`).length;
  
  // Show loading state
  displayLoadingDetails(nodeInfo, outgoing, incoming);
  
  // Fetch analysis from DeepWiki
  try {
    const analysis = await analyzeFile(nodeId);
    displayDetails({ ...nodeInfo, ...analysis }, outgoing, incoming);
  } catch (error) {
    console.error("Error analyzing file:", error);
    displayErrorDetails(nodeInfo, outgoing, incoming, error);
  }
});

// Function to analyze a file using DeepWiki API
async function analyzeFile(filePath: string): Promise<any> {
  const response = await fetch(`${DEEPWIKI_API_URL}/api/analyze_file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo_url: REPO_URL,
      file_path: filePath,
      type: REPO_TYPE,
      provider: "google",
      language: "en"
    })
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  return await response.json();
}

function createDetailsPanel(): HTMLDivElement {
  let panel = document.getElementById('details-panel') as HTMLDivElement;
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'details-panel';
    panel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 320px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 5px;
      padding: 15px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      z-index: 1000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      line-height: 1.5;
    `;
    document.body.appendChild(panel);
  }
  return panel;
}

function displayLoadingDetails(nodeInfo: any, outgoing: number, incoming: number) {
  const panel = createDetailsPanel();
  
  panel.innerHTML = `
    <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 2px solid #eee;">
      <div style="font-size: 16px; font-weight: 600; color: #333; margin-bottom: 4px;">${nodeInfo.id}</div>
      <div style="font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">${nodeInfo.dir}</div>
    </div>
    <div style="margin-bottom: 12px; padding: 20px; text-align: center;">
      <div style="color: #666; margin-bottom: 8px;">🤖 Analyzing with DeepWiki AI...</div>
      <div style="width: 100%; height: 4px; background: #eee; border-radius: 2px; overflow: hidden;">
        <div style="width: 40%; height: 100%; background: #1f77b4; animation: loading 1.5s ease-in-out infinite;"></div>
      </div>
    </div>
    <div style="margin-bottom: 12px;">
      <div style="font-size: 11px; color: #666; margin-bottom: 4px;">Dependencies</div>
      <div style="display: flex; gap: 12px;">
        <div><span style="color: #2ca02c; font-weight: 600;">${outgoing}</span> outgoing</div>
        <div><span style="color: #d62728; font-weight: 600;">${incoming}</span> incoming</div>
      </div>
    </div>
    <style>
      @keyframes loading {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(350%); }
      }
    </style>
  `;
}

function displayErrorDetails(nodeInfo: any, outgoing: number, incoming: number, error: any) {
  const panel = createDetailsPanel();
  
  panel.innerHTML = `
    <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 2px solid #eee;">
      <div style="font-size: 16px; font-weight: 600; color: #333; margin-bottom: 4px;">${nodeInfo.id}</div>
      <div style="font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">${nodeInfo.dir}</div>
    </div>
    <div style="margin-bottom: 12px; padding: 12px; background: #fee; border-left: 3px solid #d62728; color: #c33;">
      ⚠️ Failed to analyze: ${error.message || 'Unknown error'}
    </div>
    <div style="margin-bottom: 12px;">
      <div style="font-size: 11px; color: #666; margin-bottom: 4px;">Dependencies</div>
      <div style="display: flex; gap: 12px;">
        <div><span style="color: #2ca02c; font-weight: 600;">${outgoing}</span> outgoing</div>
        <div><span style="color: #d62728; font-weight: 600;">${incoming}</span> incoming</div>
      </div>
    </div>
  `;
}

function displayDetails(nodeInfo: any, outgoing: number, incoming: number) {
  const panel = createDetailsPanel();
  
  panel.innerHTML = `
    <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 2px solid #eee;">
      <div style="font-size: 16px; font-weight: 600; color: #333; margin-bottom: 4px;">${nodeInfo.id}</div>
      <div style="font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">${nodeInfo.dir}</div>
    </div>
    <div style="margin-bottom: 12px; padding: 8px; background: #f0f8ff; border-left: 3px solid #1f77b4;">
      <div style="font-size: 11px; color: #666; margin-bottom: 4px;">🤖 AI Analysis</div>
      <div style="color: #555;">${nodeInfo.description || 'No description available'}</div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
      <div style="background: #f5f5f5; padding: 8px; border-radius: 4px;">
        <div style="font-size: 11px; color: #666; margin-bottom: 2px;">Lines</div>
        <div style="font-size: 18px; font-weight: 600; color: #333;">${nodeInfo.lines || 'N/A'}</div>
      </div>
      <div style="background: #f5f5f5; padding: 8px; border-radius: 4px;">
        <div style="font-size: 11px; color: #666; margin-bottom: 2px;">Complexity</div>
        <div style="font-size: 18px; font-weight: 600; color: #333;">${nodeInfo.complexity || 'N/A'}</div>
      </div>
    </div>
    <div style="margin-bottom: 12px;">
      <div style="font-size: 11px; color: #666; margin-bottom: 4px;">Dependencies</div>
      <div style="display: flex; gap: 12px; margin-bottom: 8px;">
        <div><span style="color: #2ca02c; font-weight: 600;">${outgoing}</span> outgoing</div>
        <div><span style="color: #d62728; font-weight: 600;">${incoming}</span> incoming</div>
      </div>
      ${nodeInfo.dependencies && nodeInfo.dependencies.length > 0 ? `
        <div style="font-size: 11px; color: #666;">Related files: ${nodeInfo.dependencies.join(', ')}</div>
      ` : ''}
    </div>
    <div style="font-size: 11px; color: #999;">
      Last modified: ${nodeInfo.lastModified || 'Unknown'}
    </div>
  `;
}