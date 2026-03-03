import cytoscape from "cytoscape";
import graph from "./graph.json";
import "./style.css";

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