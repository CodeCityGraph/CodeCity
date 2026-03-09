# Start Frontend
# Starts the Vite development server on port 5173

Write-Host "Starting CodeCity Visualization..." -ForegroundColor Cyan
Write-Host "Server will run on: http://localhost:5173" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\\..")
Set-Location (Join-Path $repoRoot "codebase-map")
npm run dev
