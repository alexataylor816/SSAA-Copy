# Starts backend (Node/Express) and frontend (Expo web) locally.
# Frontend: http://localhost:8081  |  Backend: http://localhost:8000
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev" `
    -WorkingDirectory "$root\backend" -NoNewWindow

Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npx expo start --web" `
    -WorkingDirectory "$root\frontend" -NoNewWindow

Write-Host "SSAA running:"
Write-Host "  Backend  http://localhost:8000/health"
Write-Host "  Frontend http://localhost:8081"