"""
Local LLM Server for Code Analysis
Uses Ollama with CodeLlama to analyze code files
"""
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Local LLM Code Analyzer")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ollama API endpoint
OLLAMA_URL = "http://localhost:11434"
MODEL_NAME = "codellama:7b-instruct"

class FileSummaryRequest(BaseModel):
    file_path: str
    directory: str | None = None
    outgoing: int = 0
    incoming: int = 0
    related_files: list[str] = []


class GitHubRepoInput(BaseModel):
    owner: str
    repo: str
    ref: str | None = None


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "model": MODEL_NAME,
        "endpoints": [
            "GET / - Health check",
            "POST /api/analyze_file - Analyze a code file"
        ]
    }


@app.get("/api/health")
async def health_check():
    """Check if Ollama is running and model is available"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{OLLAMA_URL}/api/tags")
            if response.status_code == 200:
                models = response.json().get("models", [])
                model_available = any(
                    MODEL_NAME in model.get("name", "") for model in models
                )
                return {
                    "ollama": "running",
                    "model_available": model_available,
                    "model": MODEL_NAME
                }
    except Exception as e:
        logger.error(f"Ollama health check failed: {e}")
        return {
            "ollama": "not running",
            "error": str(e)
        }


@app.post("/api/fetch_github_zip")
async def fetch_github_zip(request: GitHubRepoInput):
    """
    Download a GitHub repository as ZIP and return the buffer
    
    Args:
        request: GitHub repository details (owner, repo, ref)
    
    Returns:
        ZIP file buffer
    """
    try:
        owner = request.owner
        repo = request.repo
        ref = request.ref or "main"  # Default to main if ref is None or empty
        
        # GitHub API to get the default branch if ref is "main" but doesn't exist
        url = f"https://github.com/{owner}/{repo}/archive/refs/heads/{ref}.zip"
        
        logger.info(f"Downloading {owner}/{repo} ref={ref}")
        
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.get(url)
            
            if response.status_code == 404:
                # Try default "main" branch if specified ref doesn't exist
                if ref != "main":
                    logger.info(f"Ref {ref} not found, trying main branch")
                    url = f"https://github.com/{owner}/{repo}/archive/refs/heads/main.zip"
                    response = await client.get(url)
                
                if response.status_code == 404:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Repository {owner}/{repo} not found or is private"
                    )
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to download repository: {response.status_code}"
                )
            
            # Return the ZIP file with appropriate headers
            return Response(
                content=response.content,
                media_type="application/zip",
                headers={
                    "Content-Disposition": f"attachment; filename={repo}.zip",
                    "X-Resolved-Ref": ref
                }
            )
            
    except httpx.TimeoutException:
        logger.error("GitHub download timed out")
        raise HTTPException(
            status_code=504,
            detail="GitHub download timed out"
        )
    except Exception as e:
        logger.error(f"Error downloading GitHub repo: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to download repository: {str(e)}"
        )


@app.post("/api/analyze_file")
async def analyze_file(request: FileSummaryRequest):
    """
    Generate AI analysis of a code file using local CodeLlama
    
    Args:
        request: File information including path, dependencies, and related files
    
    Returns:
        JSON with AI-generated description and analysis
    """
    try:
        # Calculate complexity based on coupling
        coupling = request.outgoing + request.incoming
        complexity = "high" if coupling >= 12 else "medium" if coupling >= 6 else "low"
        
        # Extract file metadata
        file_name = request.file_path.split('/')[-1]
        extension = file_name.split('.')[-1] if '.' in file_name else 'unknown'
    #File: {request.file_path}
#Directory: {request.directory or 'unknown'}
#Extension: {extension}
#Outgoing dependencies: {request.outgoing}
#Incoming dependencies: {request.incoming}
#Related files: {', '.join(request.related_files[:5]) if request.related_files else 'none'}
        # Build prompt for CodeLlama
        prompt = f"""You are a code analyst. Analyze this file based on its metadata and provide a concise 2-34 sentence summary.



Provide a technical summary describing:
1. What functions are included in this file
2. What is the main output of this file
3. main responsibility of this file

Keep your response concise (2-4 sentences) and technical. Try to avoid generic statements and focus on the specific role of this file in the codebase. Try to avoid "may", "might", "likely", or other forms of uncertainty."""

        # Call Ollama API
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": MODEL_NAME,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.7,
                        "num_predict": 150
                    }
                }
            )
            
            if response.status_code != 200:
                logger.error(f"Ollama API error: {response.status_code}")
                raise HTTPException(
                    status_code=503,
                    detail="LLM service unavailable"
                )
            
            result = response.json()
            summary = result.get("response", "").strip()
            
            if not summary:
                raise HTTPException(
                    status_code=500,
                    detail="LLM returned empty response"
                )
            
            return {
                "description": summary,
                "complexity": complexity,
                "dependencies": request.related_files[:6],
                "source": "codellama-local"
            }
            
    except httpx.ConnectError:
        logger.error("Cannot connect to Ollama. Is it running?")
        raise HTTPException(
            status_code=503,
            detail="Ollama is not running. Please start Ollama first."
        )
    except httpx.TimeoutException:
        logger.error("Ollama request timed out")
        raise HTTPException(
            status_code=504,
            detail="LLM request timed out"
        )
    except Exception as e:
        logger.error(f"Error generating analysis: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate analysis: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8002, log_level="info")
