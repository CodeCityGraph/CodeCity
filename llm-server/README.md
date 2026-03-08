# Local LLM Server for Code Analysis

This server uses **Ollama** with **CodeLlama** to provide AI-powered code analysis locally, without requiring external API keys.

## Prerequisites

### 1. Install Ollama

Download and install Ollama from: https://ollama.com/download

For Windows:
- Download the installer from https://ollama.com/download/windows
- Run the installer
- Ollama will start automatically in the background

### 2. Pull CodeLlama Model

After installing Ollama, open a terminal and run:

```bash
ollama pull codellama:7b-instruct
```

This downloads the CodeLlama 7B instruction-tuned model (~3.8 GB).

**Alternative models** (if you prefer):
- `codellama:13b-instruct` - Larger, more accurate (7.3 GB)
- `codellama:34b-instruct` - Best quality (19 GB, requires 16GB+ RAM)
- `codellama` - Base model without instruction tuning

### 3. Verify Ollama is Running

Check that Ollama is running:

```bash
ollama list
```

You should see `codellama:7b-instruct` in the list.

## Setup

### Install Python Dependencies

```bash
cd llm-server
pip install -r requirements.txt
```

## Running the Server

### Start the LLM Server

```bash
python server.py
```

The server will start on **http://localhost:8001**

### Check Health

Visit http://localhost:8001 in your browser or run:

```bash
curl http://localhost:8001/api/health
```

Expected response:
```json
{
  "ollama": "running",
  "model_available": true,
  "model": "codellama:7b-instruct"
}
```

## API Endpoints

### `POST /api/analyze_file`

Analyze a code file using CodeLlama.

**Request:**
```json
{
  "file_path": "src/main.ts",
  "directory": "src",
  "outgoing": 5,
  "incoming": 3,
  "related_files": ["utils.ts", "types.ts"]
}
```

**Response:**
```json
{
  "description": "AI-generated summary of the file's purpose and role",
  "complexity": "medium",
  "dependencies": ["utils.ts", "types.ts"],
  "source": "codellama-local"
}
```

## Troubleshooting

### Ollama Not Running

**Error:** `Ollama is not running. Please start Ollama first.`

**Fix:** 
- On Windows: Ollama should start automatically. Check system tray.
- Manually start: Run `ollama serve` in a terminal

### Model Not Found

**Error:** Model not available in health check

**Fix:**
```bash
ollama pull codellama:7b-instruct
```

### Slow Responses

CodeLlama inference speed depends on your hardware:
- **CPU only**: 5-30 seconds per request
- **GPU (NVIDIA)**: 1-5 seconds per request

To speed up:
1. Use smaller model: `codellama:7b-instruct` (fastest)
2. Ensure Ollama is using GPU if available
3. Reduce `num_predict` in server.py

### Memory Issues

If you run out of memory:
- Use smaller model: `codellama:7b-instruct` instead of `13b` or `34b`
- Close other applications
- Reduce concurrent requests

## Configuration

Edit `server.py` to customize:

```python
# Change model
MODEL_NAME = "codellama:13b-instruct"  # Use larger model

# Change port
uvicorn.run(app, host="0.0.0.0", port=8002)  # Different port

# Adjust generation parameters
"options": {
    "temperature": 0.5,  # Lower = more deterministic
    "num_predict": 200   # More tokens = longer responses
}
```

## Performance Tips

1. **Keep Ollama running**: First request loads the model (slow), subsequent requests are faster
2. **GPU acceleration**: Ollama automatically uses NVIDIA/AMD GPU if available
3. **Model choice**: 7B is fastest, 13B is balanced, 34B is most accurate but slow
