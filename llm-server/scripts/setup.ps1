# Quick Start Script - CodeCity LLM setup
# Supports Ollama (default) or Gemini

Write-Host "=== CodeCity Setup ===" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\\..")

$provider = if ($env:LLM_PROVIDER) { $env:LLM_PROVIDER.ToLowerInvariant() } else { "ollama" }

if ($provider -eq "gemini") {
    Write-Host "LLM provider: Gemini" -ForegroundColor Cyan
    if (-not $env:GEMINI_API_KEY) {
        Write-Host "⚠️  GEMINI_API_KEY is not set in this shell." -ForegroundColor Yellow
        Write-Host "Set it before starting the server:" -ForegroundColor Yellow
        Write-Host "`$env:GEMINI_API_KEY = \"<your-key>\"" -ForegroundColor White
    } else {
        Write-Host "✅ GEMINI_API_KEY is set" -ForegroundColor Green
    }
    Write-Host ""
} else {
    # Check if Ollama is installed
    Write-Host "Checking Ollama installation..." -ForegroundColor Yellow
    $ollamaInstalled = Get-Command ollama -ErrorAction SilentlyContinue

    if (-not $ollamaInstalled) {
        Write-Host "❌ Ollama not found!" -ForegroundColor Red
        Write-Host "Please install Ollama from: https://ollama.com/download" -ForegroundColor Yellow
        Write-Host "After installation, run this script again." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "✅ Ollama is installed" -ForegroundColor Green
    Write-Host ""

    # Check if model is pulled
    Write-Host "Checking for CodeLlama model..." -ForegroundColor Yellow
    $models = ollama list 2>&1
    if ($models -match "codellama:7b-instruct") {
        Write-Host "✅ CodeLlama model is available" -ForegroundColor Green
    } else {
        Write-Host "⬇️  Downloading CodeLlama model (this may take a few minutes)..." -ForegroundColor Yellow
        ollama pull codellama:7b-instruct
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ CodeLlama model downloaded successfully" -ForegroundColor Green
        } else {
            Write-Host "❌ Failed to download CodeLlama model" -ForegroundColor Red
            exit 1
        }
    }
    Write-Host ""
}

# Install Python dependencies
Write-Host "Setting up LLM server..." -ForegroundColor Yellow
Push-Location (Join-Path $repoRoot "llm-server")
try {
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd) {
        Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
        python -m pip install -r requirements.txt --quiet
        Write-Host "✅ LLM server dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Python not found. Please install Python 3.12+" -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}
Write-Host ""

# Install frontend dependencies
Write-Host "Setting up frontend..." -ForegroundColor Yellow
Push-Location (Join-Path $repoRoot "codebase-map")
try {
    if (Test-Path "node_modules") {
        Write-Host "✅ Frontend dependencies already installed" -ForegroundColor Green
    } else {
        Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
        npm install
        Write-Host "✅ Frontend dependencies installed" -ForegroundColor Green
    }
} finally {
    Pop-Location
}
Write-Host ""

Write-Host "=== Setup Complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "To start the application:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1️⃣  Start LLM server (in one terminal):" -ForegroundColor Yellow
Write-Host "   .\\llm-server\\scripts\\start-llm-server.ps1" -ForegroundColor White
Write-Host ""
if ($provider -eq "gemini") {
    Write-Host "Gemini mode active. Ensure these vars are set in that terminal:" -ForegroundColor Yellow
    Write-Host "   `$env:LLM_PROVIDER = \"gemini\"" -ForegroundColor White
    Write-Host "   `$env:GEMINI_API_KEY = \"<your-key>\"" -ForegroundColor White
    Write-Host ""
}

Write-Host "2️⃣  Start frontend (in another terminal):" -ForegroundColor Yellow  
Write-Host "   .\\llm-server\\scripts\\start-frontend.ps1" -ForegroundColor White
Write-Host ""
Write-Host "3️⃣  Open browser to: http://localhost:5173" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Enter to continue..." -ForegroundColor Gray
Read-Host
