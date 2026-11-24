param(
    [Parameter(Mandatory = $true)][string]$InfPath,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Continue'
$result = [ordered]@{
    ok             = $false
    status         = 'error'
    exitCode       = -1
    codes          = @()
    output         = ''
    target         = $InfPath
    kind           = 'file'
    warning        = $null
    installed      = 0
    failed         = 0
    rebootRequired = $false
}

function Add-DriverFile {
    param([string]$Path)

    $out = & pnputil.exe /add-driver "$Path" /install 2>&1 | Out-String
    $code = if ($LASTEXITCODE -ne $null) { [int]$LASTEXITCODE } else { 0 }
    $added = 0
    if ($out -match '(?:Added driver packages|Paquetes de controlador(?:es)? agregados)\s*:\s*(\d+)') {
        $added = [int]$Matches[1]
    }
    return [pscustomobject]@{ text = $out.Trim(); code = $code; added = $added }
}

try {
    $resolved = (Resolve-Path -LiteralPath $InfPath -ErrorAction Stop).Path
    $result.target = $resolved

    if (Test-Path -LiteralPath $resolved -PathType Container) {
        $result.kind = 'folder'
        # pnputil's /subdirs is unreliable across Windows builds (exit 87 on 19044),
        # so every .inf is applied explicitly.
        $infs = @(Get-ChildItem -LiteralPath $resolved -Filter *.inf -File -Recurse -ErrorAction SilentlyContinue)
        if ($infs.Count -eq 0) { throw "La carpeta no contiene archivos .inf: $resolved" }

        $added = 0
        $codes = @()
        $chunks = @()
        foreach ($inf in $infs) {
            $one = Add-DriverFile -Path $inf.FullName
            $codes += $one.code
            $added += $one.added
            $chunks += ("[" + $inf.Name + "] exit " + $one.code + "`r`n" + $one.text)
        }
        $result.codes = $codes
        $result.exitCode = ($codes | Select-Object -First 1)
        $result.output = ($chunks -join "`r`n`r`n")
        $result.installed = $added
    }
    else {
        if ([System.IO.Path]::GetExtension($resolved).ToLowerInvariant() -ne '.inf') {
            throw "El archivo no es un paquete .inf: $resolved"
        }
        $one = Add-DriverFile -Path $resolved
        $result.codes = @($one.code)
        $result.exitCode = $one.code
        $result.output = $one.text
        $result.installed = $one.added
    }

    $hardErrors = @($result.codes | Where-Object { $_ -ne 0 -and $_ -ne 3010 -and $_ -ne 1641 -and $_ -ne 259 })
    $reboot = @($result.codes | Where-Object { $_ -eq 3010 -or $_ -eq 1641 }).Count -gt 0
    $noDevice = @($result.codes | Where-Object { $_ -eq 259 }).Count -gt 0

    $result.failed = $hardErrors.Count
    $result.rebootRequired = $reboot
    $result.ok = ($hardErrors.Count -eq 0)
    if ($hardErrors.Count -gt 0) { $result.status = 'error' }
    elseif ($reboot) { $result.status = 'reboot' }
    elseif ($noDevice) { $result.status = 'no-device' }
    else { $result.status = 'ok' }

    if ($result.ok -and $result.installed -eq 0 -and $result.status -eq 'ok') {
        $result.warning = 'pnputil no añadió ningún paquete nuevo: el .inf puede no aplicar a este equipo, o ya estaba instalado.'
    }
}
catch {
    $result.output = $_.Exception.Message
    $result.ok = $false
    $result.status = 'error'
}

try {
    $result | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $OutFile -Encoding UTF8
}
catch { }
