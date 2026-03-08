# CodeCity Visualization

Codebase visualization tool with AI-powered file analysis using **local CodeLlama**.

## Quick Start

### 1. Install Ollama

Download and install Ollama from: **https://ollama.com/download**

For Windows, download the installer and run it. Ollama will start automatically in the background.

### 2. Pull CodeLlama Model

Open PowerShell and run:

```powershell
ollama pull codellama:7b-instruct
```

This downloads the CodeLlama 7B model (~3.8 GB). First-time download takes a few minutes.

### 3. Start the LLM Server

```powershell
cd llm-server
pip install -r requirements.txt
python server.py
```

The server starts at **http://localhost:8001**

### 4. Start the Visualization

In a new terminal:

```powershell
cd codebase-map
npm install
npm run dev
```

The visualization opens at **http://localhost:5173**

## Usage

1. Open http://localhost:5173 in your browser
2. Click any node in the graph
3. CodeLlama analyzes the file and shows:
   - AI-generated description
   - Complexity analysis
   - Dependency information

## Architecture

- **Frontend**: Vite + TypeScript + Cytoscape.js (graph visualization)
- **LLM Server**: FastAPI + Ollama + CodeLlama (local AI analysis)
- **No external APIs required** - runs completely offline

## Troubleshooting

### "Ollama is not running"

- Windows: Check system tray for Ollama icon
- Or run manually: `ollama serve`

### Slow analysis

- First request loads model (10-30 seconds)  
- Subsequent requests are faster (2-10 seconds)
- Speed depends on CPU/GPU

### Connection refused

Make sure both servers are running:
1. LLM server on port 8001
2. Vite dev server on port 5173

## Customization

### Use different CodeLlama model

Edit `llm-server/server.py`:

```python
MODEL_NAME = "codellama:13b-instruct"  # Larger, more accurate
```

Pull the model:
```bash
ollama pull codellama:13b-instruct
```

### Change analysis prompt

Edit the `prompt` variable in `llm-server/server.py` to customize what CodeLlama analyzes.

## Project Structure

```
CodeCity/
├── codebase-map/          # Frontend visualization
│   ├── src/
│   │   ├── main.ts        # Main application logic  
│   │   ├── graph.json     # Graph data
│   │   └── style.css      # Styles
│   └── package.json
│
└── llm-server/            # Local LLM backend
    ├── server.py          # FastAPI server
    ├── requirements.txt   # Python dependencies
    └── README.md          # Detailed server docs
```

## Benefits of Local LLM

✅ **No API keys required** - runs completely offline  
✅ **No usage costs** - unlimited analysis  
✅ **Privacy** - code never leaves your machine  
✅ **Fast** - local inference (especially with GPU)  
✅ **Customizable** - modify prompts and models freely
