# Start LLM Server
# Starts the local CodeLlama server on port 8002

Write-Host "Starting Local LLM Server with CodeLlama..." -ForegroundColor Cyan
Write-Host "Server will run on: http://localhost:8002" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir "..")
python server.py
