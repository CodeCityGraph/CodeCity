# Start LLM Server
# Starts the provider-backed server (Ollama or Gemini) on port 8002

Write-Host "Starting Local LLM Server..." -ForegroundColor Cyan
Write-Host "Server will run on: http://localhost:8002" -ForegroundColor Yellow
$provider = if ($env:LLM_PROVIDER) { $env:LLM_PROVIDER.ToLowerInvariant() } else { "ollama" }

if ($provider -eq "gemini") {
	Write-Host "Provider: Gemini" -ForegroundColor Yellow
	if (-not $env:GEMINI_API_KEY) {
		Write-Host "Warning: GEMINI_API_KEY is not set. Requests will fail until configured." -ForegroundColor Red
	}
} else {
	Write-Host "Provider: Ollama" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir "..")
python server.py
