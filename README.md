# CodeCity

CodeCity is a Sprint 1 prototype that converts a repository into an interactive dependency map ("city/galaxy" style view) for exploration.

## Sprint 1 Scope (Implemented)

- Load a repository `.zip` in the browser
- Load a public GitHub repository link (`github.com/owner/repo`) directly
- Analyze JS/TS files and generate a graph in-memory
- Render a clustered dependency map with pan/zoom
- Show legend/help + node details panel
- Support fuzzy search + focus for files

## Sprint 2 Core Additions (Implemented)

- Critical file visual indicators for high coupling/risk nodes
- Most depended-on files filter (top in-degree percentage)
- Selected node neighborhood focus (off, 1-hop, 2-hop)
- Dependency direction analysis for selected node (all/incoming/outgoing)
- Edge semantics:
  - Static import vs dynamic import
  - Internal dependency vs external dependency
- External package nodes rendered directly in the map
- Always-available heuristic file summaries in Details panel
- Optional LLM summaries with safe fallback when local server/model is unavailable

## Tech Stack

- TypeScript
- Vite
- Cytoscape.js
- JSZip
- Node.js `>=22.12.0` (recommended: latest Node 22 LTS)

## Project Structure

- `codebase-map/` - main frontend app
- `llm-server/` - local FastAPI backend that calls Ollama/CodeLlama for node summaries
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

If you want to load repositories from GitHub URLs, also run the local backend proxy:

```bash
cd llm-server
pip install -r requirements.txt
python server.py
```

This starts the proxy at `http://localhost:8002`.

## Local AI Backend (LLM Server)

The frontend is integrated with a local LLM backend for file-level summaries:

- Frontend calls: `http://localhost:8002/api/analyze_file`
- Backend: FastAPI (`llm-server/server.py`)
- Model runtime: provider-based (`ollama` or `gemini`)

For full backend setup, Ollama install, and troubleshooting steps, see:

- `llm-server/README.md`

Note: You can run the frontend without the LLM server if you only use zip uploads.  
For GitHub URL loading, run `llm-server` so the proxy endpoint can fetch archives server-side.

Windows PowerShell helper scripts are now organized under:

- `llm-server/scripts/setup.ps1`
- `llm-server/scripts/start-llm-server.ps1`
- `llm-server/scripts/start-frontend.ps1`

## How to Use (Integration Workflow)

1. Click **Load Repo Zip** and select a repository `.zip`.
2. Or paste a public GitHub URL and click **Load**.
3. The app analyzes repository files and creates a graph:
   - Nodes: all files (except ignored directories), plus external package nodes
   - Edges: source/target dependency or reference relationships
4. Explore the map:
   - Drag nodes to reposition
   - Pan the view (bounded to visible graph area)
   - Zoom in is allowed; zoom out is limited to the initial full-graph fit
   - Color indicates directory cluster
   - Node size reflects file size
   - Click node for detailed metrics
5. Use **Search + Focus** to highlight matching files and related edges.
6. Use the sidebar filters to inspect:
   - Most depended-on files
   - Selected-node neighborhood
   - Incoming/outgoing dependencies
   - Static/dynamic and internal/external dependency types
7. Use **Load Sample** to return to the built-in demo graph.

## Dummy Sample Data

You can use the included fixture zip for a quick demo:

- `codebase-map/fixtures/dummy-repo.zip`

This fixture contains sample JS/TS files plus ignored folders (`dist`, `node_modules`) to validate analyzer behavior.

## Analyzer Behavior (Current)

- Ignores directories: `node_modules`, `dist`, `out`, `.output`, `.git`
- Includes all other files as map nodes
- Dependency extraction supports multiple ecosystems (regex-based):
  - JS/TS: `import`, `require`, dynamic `import()`
  - Python: `import`, `from ... import ...`
  - C/C++: `#include`
  - Java/Kotlin/Scala: `import`
  - C#: `using`
  - Go: `import`
  - Rust: `use`
  - PHP: `require/include/use`
  - Ruby: `require`, `require_relative`
  - HTML: `src`, `href`, `data` references
  - CSS/SCSS/SASS/LESS: `@import`, `url(...)`
- Unknown or binary files are still mapped as nodes (dependencies may be unavailable).
- Unresolved references are logged and do not crash analysis.
