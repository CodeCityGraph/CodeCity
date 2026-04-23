# Local LLM Server for Code Analysis

This server supports two LLM providers for code analysis:

- `ollama` (default): local CodeLlama or any Ollama model
- `gemini`: Google Gemini via API key

## Provider Configuration

The server reads provider settings from environment variables:

```bash
# Required provider selector
LLM_PROVIDER=ollama   # or gemini

# Optional model override
LLM_MODEL=codellama:7b-instruct   # ollama example
# LLM_MODEL=gemini-1.5-flash      # gemini example

# Required only when LLM_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
```

If unset, the defaults are:

- `LLM_PROVIDER=ollama`
- `LLM_MODEL=codellama:7b-instruct`

## Prerequisites (Ollama Mode)

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

## Prerequisites (Gemini Mode)

1. Create a Gemini API key in Google AI Studio.
2. Set environment variables before starting the server:

```powershell
$env:LLM_PROVIDER = "gemini"
$env:LLM_MODEL = "gemini-1.5-flash"
$env:GEMINI_API_KEY = "<your-key>"
```

You can omit `LLM_MODEL` to use the server default for Gemini.

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

The server will start on **http://localhost:8002**

### Check Health

Visit http://localhost:8002 in your browser or run:

```bash
curl http://localhost:8002/api/health
```

Expected response (Ollama):
```json
{
  "provider": "ollama",
  "status": "running",
  "model_available": true,
  "model": "codellama:7b-instruct"
}
```

Expected response (Gemini):
```json
{
  "provider": "gemini",
  "status": "configured",
  "model_available": true,
  "model": "gemini-1.5-flash"
}
```

### Windows helper scripts

PowerShell helper scripts are located in:

- `llm-server/scripts/setup.ps1`
- `llm-server/scripts/start-llm-server.ps1`
- `llm-server/scripts/start-frontend.ps1`

From repository root, you can run:

```powershell
.\llm-server\scripts\setup.ps1
.\llm-server\scripts\start-llm-server.ps1
.\llm-server\scripts\start-frontend.ps1
```

## API Endpoints

### `POST /api/fetch_github_zip`

Download a public GitHub repository archive server-side (used by frontend GitHub URL loader to avoid browser CORS issues).

**Request:**
```json
{
  "owner": "Vaish1405",
  "repo": "school-smart",
  "ref": null
}
```

`ref` is optional. When omitted, the server tries the default branch, then `main`, then `master`.

**Response:**
- `200 application/zip` (binary zip content)
- Response header: `X-GitHub-Resolved-Ref` with the branch/tag that was fetched

### `POST /api/analyze_file`

Analyze a code file using the active provider (Ollama or Gemini).

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
  "source": "gemini:gemini-1.5-flash"
}
```

## Troubleshooting

### GitHub URL Loading Fails in Frontend

If frontend shows GitHub load failure:
1. Ensure this server is running on `http://localhost:8002`
2. Verify endpoint directly:
```bash
curl -I -X POST http://localhost:8002/api/fetch_github_zip \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"Vaish1405\",\"repo\":\"school-smart\"}"
```
3. Confirm the repository is public and accessible.

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

### Gemini Not Configured

**Error:** Gemini selected but unavailable

**Fix:**
- Ensure `LLM_PROVIDER=gemini`
- Ensure `GEMINI_API_KEY` is set in the same shell used to run `python server.py`
- Check `GET /api/health` response for `status` and `error`

## Configuration

Edit `server.py` to customize:

```python
# Change provider/model through env vars
LLM_PROVIDER=gemini
LLM_MODEL=gemini-1.5-flash
GEMINI_API_KEY=your_key_here

# Change port
uvicorn.run(app, host="0.0.0.0", port=8002)  # Different port
```

## Performance Tips

1. **Keep Ollama running**: First request loads the model (slow), subsequent requests are faster
2. **GPU acceleration**: Ollama automatically uses NVIDIA/AMD GPU if available
3. **Model choice**: 7B is fastest, 13B is balanced, 34B is most accurate but slow
