# Start LLM Server
# Starts the local CodeLlama server on port 8001

Write-Host "Starting Local LLM Server with CodeLlama..." -ForegroundColor Cyan
Write-Host "Server will run on: http://localhost:8001" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

Set-Location llm-server
python server.py
