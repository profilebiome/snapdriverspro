param(
    [string]$Owner = "profilebiome",
    [string]$Repo = "snapdriverspro"
)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "1) Autenticación de GitHub" -ForegroundColor Cyan
gh auth status
if ($LASTEXITCODE -ne 0) {
    Write-Host "   Ejecuta: gh auth login" -ForegroundColor Yellow
}

Write-Host "`n2) Repositorio remoto" -ForegroundColor Cyan
$remote = git remote get-url origin 2>$null
if (-not $remote) {
    git remote add origin "https://github.com/$Owner/$Repo.git"
    Write-Host "   origin añadido." -ForegroundColor Green
} else {
    Write-Host "   origin ya existe: $remote"
}

Write-Host "`n3) Crear el repositorio si no existe y subir" -ForegroundColor Cyan
gh repo view "$Owner/$Repo" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    gh repo create "$Owner/$Repo" --public --source . --remote origin --push
} else {
    git push -u origin main
}

Write-Host "`n4) GitHub Pages desde /docs" -ForegroundColor Cyan
gh api -X POST "repos/$Owner/$Repo/pages" -f "source[branch]=main" -f "source[path]=/docs" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    gh api -X PUT "repos/$Owner/$Repo/pages" -f "source[branch]=main" -f "source[path]=/docs" 2>$null | Out-Null
}
Write-Host "   Web: https://$Owner.github.io/$Repo/" -ForegroundColor Green

Write-Host "`n5) Primera release (crea el tag vX.Y.Z y sube el instalador)" -ForegroundColor Cyan
Write-Host "   npm run release   (o .\scripts\release.ps1)"
