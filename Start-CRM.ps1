param(
    [string]$Root = "C:\Users\tysir\OneDrive\Desktop\LegacyWholesaleCRM"
)

$ErrorActionPreference = "Stop"
Set-Location $Root

if (-not (Test-Path ".\node_modules")) {
    Write-Host "node_modules is missing. Running npm install first..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
}

npm run dev
