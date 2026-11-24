param(
    [string]$Note = "Actualización de Snap Drivers Pro",
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
$outDir = "dist-release"

Write-Host "== Snap Drivers Pro $version ==" -ForegroundColor Cyan

if (-not $SkipTests) {
    Write-Host "`n[1/5] Pruebas" -ForegroundColor Yellow
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Las pruebas fallaron; no se publica nada.' }
}

Write-Host "`n[2/5] Commit y push" -ForegroundColor Yellow
git add -A
if (git status --porcelain) { git commit -m "release: $tag — $Note" }
git push

Write-Host "`n[3/5] Compilando el instalador" -ForegroundColor Yellow
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
npx electron-builder --win nsis --x64 --config.directories.output=$outDir
if ($LASTEXITCODE -ne 0) { throw 'La compilación falló.' }
if (-not $env:GH_TOKEN) {
    $env:GH_TOKEN = (gh auth token)
}

Write-Host "`n[4/5] Creando la release y subiendo los archivos" -ForegroundColor Yellow
# La publicación integrada de electron-builder puede cortarse con instaladores
# grandes; subir con gh es más fiable y deja la release igual de válida.
gh release create $tag --title "Snap Drivers Pro $version" --notes $Note 2>$null
if ($LASTEXITCODE -ne 0) {
    gh release edit $tag --notes $Note
}
gh release upload $tag `
    "$outDir\Snap-Drivers-Pro-Setup.exe" `
    "$outDir\Snap-Drivers-Pro-Setup.exe.blockmap" `
    "$outDir\latest.yml" `
    --clobber
if ($LASTEXITCODE -ne 0) { throw 'La subida falló.' }

Write-Host "`n[5/5] Listo" -ForegroundColor Green
gh release view $tag --json assets -q '.assets[] | .name + "  " + (.size|tostring)'
Write-Host "Descarga directa: https://github.com/profilebiome/snapdriverspro/releases/latest/download/Snap-Drivers-Pro-Setup.exe"
Write-Host "Web: https://snapdrivers.profilebio.me/"
