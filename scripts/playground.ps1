# Runs SSAA on a throwaway demo database so you can click around freely.
# Your real backend/ssaa.db is never touched.
#
#   .\scripts\playground.ps1          # reuse the playground data from last time
#   .\scripts\playground.ps1 -Reset   # start over with fresh demo data
#
# Sign in as any demo account (password Demo1234!), e.g. gina.torres@example.com
# (GC) or bao.plumbing@example.com (sub). Full list: database/README.md.
param(
    [switch]$Reset
)

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$db = Join-Path $root "backend\playground.db"   # *.db is git-ignored

if ($Reset -or -not (Test-Path $db)) {
    Write-Host "Building fresh demo data..."
    Push-Location "$root\backend"
    npx tsx scripts/seed-demo.ts --out $db
    Pop-Location
}

# Child processes inherit these; they win over backend/.env.
$env:DATABASE_PATH = $db
$env:DB_CLIENT = "sqlite"
$env:EXPOSE_DEV_CODES = "true"   # show reset codes on screen; demo emails are fake

Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev" `
    -WorkingDirectory "$root\backend" -NoNewWindow
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev" `
    -WorkingDirectory "$root\web" -NoNewWindow

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.PrefixOrigin -in "Dhcp", "Manual" -and $_.IPAddress -notlike "169.*" } |
    Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "SSAA playground running (demo data, password Demo1234!):"
Write-Host "  This PC:            http://localhost:8082"
if ($ip) { Write-Host "  Phone on same Wi-Fi: http://${ip}:8082" }
Write-Host "  Start over:         .\scripts\playground.ps1 -Reset"
