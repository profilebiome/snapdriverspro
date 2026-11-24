param(
    [string]$Note = "Actualización de Snap Drivers Pro",
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "== Snap Drivers Pro $version ==" -ForegroundColor Cyan

if (-not $SkipTests) {
    Write-Host "`n[1/5] Pruebas" -ForegroundColor Yellow
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Las pruebas fallaron; no se publica nada.' }
}

Write-Host "`n[2/5] Commit y push" -ForegroundColor Yellow
git add -A
$pending = git status --porcelain
if ($pending) {
    git commit -m "release: v$version — $Note"
}
git push

Write-Host "`n[3/5] Build + publicación en GitHub Releases" -ForegroundColor Yellow
if (-not $env:GH_TOKEN) {
    Write-Host 'Aviso: sin GH_TOKEN se usará el login de gh (gh auth login).' -ForegroundColor DarkYellow
}
npx electron-builder --win nsis --x64 --publish always
if ($LASTEXITCODE -ne 0) { throw 'La publicación falló.' }

Write-Host "`n[4/5] Comprobando la release" -ForegroundColor Yellow
gh release view "v$version" --web

Write-Host "`n[5/5] Listo" -ForegroundColor Green
Write-Host "Descarga directa:" -NoNewline
Write-Host " https://github.com/profilebiome/snapdriverspro/releases/latest/download/Snap-Drivers-Pro-Setup.exe"
Write-Host "Los clientes verán el aviso de actualización en su siguiente arranque (o al pulsar «Buscar actualizaciones»)."
