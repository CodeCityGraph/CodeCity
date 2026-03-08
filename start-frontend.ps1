# Start Frontend
# Starts the Vite development server on port 5173

Write-Host "Starting CodeCity Visualization..." -ForegroundColor Cyan
Write-Host "Server will run on: http://localhost:5173" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

Set-Location codebase-map
npm run dev
