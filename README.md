# CodeCity

CodeCity is a Sprint 1 prototype that converts a repository into an interactive dependency map ("city/galaxy" style view) for exploration.

## Sprint 1 Scope (Implemented)

- Load a repository `.zip` in the browser
- Analyze JS/TS files and generate a graph in-memory
- Render a clustered dependency map with pan/zoom
- Show legend/help + node details panel
- Support fuzzy search + focus for files

## Tech Stack

- TypeScript
- Vite
- Cytoscape.js
- JSZip
- Node.js `>=22.12.0` (recommended: latest Node 22 LTS)

## Project Structure

- `codebase-map/` - main frontend app
- `codebase-map/src/main.ts` - app wiring (upload, search/focus, status, details)
- `codebase-map/src/analyzer.ts` - zip -> graph analyzer pipeline
- `codebase-map/src/viewer.ts` - Cytoscape viewer creation and styling
- `codebase-map/src/layout.ts` - directory-cluster initial positioning
- `codebase-map/src/types.ts` - graph/analyzer types
- `codebase-map/src/graph.json` - sample graph fallback

## Setup and Run

```bash
# from repository root
cd codebase-map
nvm use || nvm install
npm install
npm run dev
```

Important: run `npm run dev` inside `codebase-map/` (not repo root).

Then open the local URL printed by Vite (typically `http://localhost:5173/`).

## How to Use (Integration Workflow)

1. Click **Load Repo Zip** and select a repository `.zip`.
2. The app analyzes JS/TS imports and creates a graph:
   - Nodes: file path, directory, extension, size, LOC, degree metrics, risk score
   - Edges: source/target import relationships
3. Explore the map:
   - Drag nodes to reposition
   - Pan the view (bounded to visible graph area)
   - Zoom in is allowed; zoom out is limited to the initial full-graph fit
   - Color indicates directory cluster
   - Node size reflects file size
   - Click node for detailed metrics
4. Use **Search + Focus** to highlight matching files and related edges.
5. Use **Load Sample** to return to the built-in demo graph.

## Dummy Sample Data

You can use the included fixture zip for a quick demo:

- `codebase-map/fixtures/dummy-repo.zip`

This fixture contains sample JS/TS files plus ignored folders (`dist`, `node_modules`) to validate analyzer behavior.

## Analyzer Behavior (Current)

- Ignores: `node_modules`, `dist`, `out`, `.output`, `.git`
- Extensions: `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`
- Dependency extraction: regex-based for:
  - `import ... from "x"`
  - `import "x"`
  - `require("x")`
  - `import("x")`
- Unresolved imports are logged and do not crash the analysis.
