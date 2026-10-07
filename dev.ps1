# Starts the backend and the web client locally.
# Web: http://localhost:8082  |  Backend: http://localhost:8000
#
# The Expo app in frontend/ is the paused mobile client; it is no longer
# started by default. Run it by hand when you need it: npx expo start --web
param(
    [switch]$WithExpo
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev" `
    -WorkingDirectory "$root\backend" -NoNewWindow

Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev" `
    -WorkingDirectory "$root\web" -NoNewWindow

if ($WithExpo) {
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npx expo start --web" `
        -WorkingDirectory "$root\frontend" -NoNewWindow
}

Write-Host "SSAA running:"
Write-Host "  Backend http://localhost:8000/health"
Write-Host "  Web     http://localhost:8082"
if ($WithExpo) {
    Write-Host "  Expo    http://localhost:8081"
}
else {
    Write-Host "  (Expo not started - pass -WithExpo to include the paused mobile client)"
}
