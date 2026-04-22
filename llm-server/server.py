"""
Local server for CodeCity integrations:
- LLM-based file analysis (optional)
- GitHub archive proxy for repo ingestion
"""
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Response
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
    expose_headers=["X-GitHub-Resolved-Ref"],
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


class GitHubZipRequest(BaseModel):
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
            "POST /api/analyze_file - Analyze a code file",
            "POST /api/fetch_github_zip - Download public GitHub repo archive"
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
        
        # Extract file metadata for prompt context.
        file_name = request.file_path.split('/')[-1]
        extension = file_name.split('.')[-1] if '.' in file_name else 'unknown'
        related_preview = ", ".join(request.related_files[:5]) if request.related_files else "none"

        # Build prompt for CodeLlama.
        prompt = f"""You are a code analyst.

File: {request.file_path}
Directory: {request.directory or 'unknown'}
Extension: {extension}
Outgoing dependencies: {request.outgoing}
Incoming dependencies: {request.incoming}
Related files: {related_preview}

Write a concise technical summary in 2-4 sentences that covers:
1. The file's likely responsibilities
2. How it connects to surrounding files
3. Why it matters in the codebase

Avoid vague language and avoid stating uncertainty."""

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


def _encode_ref_for_path(ref: str) -> str:
    return "/".join(quote(part, safe="") for part in ref.split("/") if part)


async def _fetch_default_branch(owner: str, repo: str) -> str | None:
    url = f"https://api.github.com/repos/{owner}/{repo}"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(url)
            if response.status_code != 200:
                return None
            payload = response.json()
            branch = str(payload.get("default_branch", "")).strip()
            return branch if branch else None
    except Exception:
        return None


async def _try_fetch_archive(url: str) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as client:
            response = await client.get(url)
            if response.status_code == 200:
                return response.content
            if response.status_code == 404:
                return None
            raise HTTPException(
                status_code=502,
                detail=f"GitHub archive request failed ({response.status_code})."
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub request failed: {exc}") from exc


@app.post("/api/fetch_github_zip")
async def fetch_github_zip(request: GitHubZipRequest):
    """
    Server-side GitHub zip fetch to avoid browser-side CORS issues.
    Supports public repositories only.
    """
    owner = request.owner.strip()
    repo = request.repo.strip().removesuffix(".git")
    ref = request.ref.strip() if request.ref else None

    if not owner or not repo:
        raise HTTPException(status_code=400, detail="owner and repo are required.")

    branch_candidates: list[str] = []
    if ref:
        branch_candidates.append(ref)
    else:
        default_branch = await _fetch_default_branch(owner, repo)
        if default_branch:
            branch_candidates.append(default_branch)
        if "main" not in branch_candidates:
            branch_candidates.append("main")
        if "master" not in branch_candidates:
            branch_candidates.append("master")

    for branch in branch_candidates:
        encoded = _encode_ref_for_path(branch)
        branch_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{encoded}"
        zip_bytes = await _try_fetch_archive(branch_url)
        if zip_bytes:
            return Response(
                content=zip_bytes,
                media_type="application/zip",
                headers={
                    "X-GitHub-Resolved-Ref": branch,
                    "Cache-Control": "no-store",
                },
            )

    if ref:
        encoded_tag = _encode_ref_for_path(ref)
        tag_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/tags/{encoded_tag}"
        tag_zip = await _try_fetch_archive(tag_url)
        if tag_zip:
            return Response(
                content=tag_zip,
                media_type="application/zip",
                headers={
                    "X-GitHub-Resolved-Ref": ref,
                    "Cache-Control": "no-store",
                },
            )

    raise HTTPException(
        status_code=404,
        detail=f"Could not fetch archive for {owner}/{repo}. Ensure repository is public and ref exists."
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8002, log_level="info")
