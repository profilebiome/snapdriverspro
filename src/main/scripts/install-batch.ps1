param(
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Continue'
$results = @()

try {
    $parsed = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($parsed -is [System.Array]) { $items = @($parsed) }
    elseif ($null -ne $parsed) { $items = @($parsed) }
    else { $items = @() }
}
catch {
    $items = @()
}

function Find-InfsForDevice {
    param([string]$Directory, [string[]]$HardwareIds)

    $all = @(Get-ChildItem -LiteralPath $Directory -Filter *.inf -File -Recurse -ErrorAction SilentlyContinue)
    if ($all.Count -eq 0) { return @() }
    if (-not $HardwareIds -or $HardwareIds.Count -eq 0) { return $all }

    $matches = @()
    foreach ($inf in $all) {
        $text = ''
        try { $text = [System.IO.File]::ReadAllText($inf.FullName) } catch { continue }
        foreach ($id in $HardwareIds) {
            if (-not $id) { continue }
            $short = ($id -split '&subsys')[0]
            if ($text.IndexOf($short, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $matches += $inf
                break
            }
        }
    }
    return $matches
}

foreach ($item in $items) {
    $entry = [ordered]@{
        label          = [string]$item.label
        path           = [string]$item.path
        ok             = $false
        status         = 'error'
        exitCode       = -1
        codes          = @()
        added          = 0
        failed         = 0
        rebootRequired = $false
        infs           = 0
        output         = ''
    }
    try {
        $resolved = (Resolve-Path -LiteralPath $item.path -ErrorAction Stop).Path
        $entry.path = $resolved
        $hardwareIds = @($item.hardwareIds | Where-Object { $_ })

        $targets = @(Find-InfsForDevice -Directory $resolved -HardwareIds $hardwareIds)
        if ($targets.Count -eq 0) {
            if ($hardwareIds.Count -gt 0) { throw 'El paquete descargado no contiene el hardware ID de este dispositivo.' }
            throw 'La carpeta no contiene archivos .inf.'
        }

        $added = 0
        $codes = @()
        $chunks = @()
        foreach ($inf in $targets) {
            $out = & pnputil.exe /add-driver "$($inf.FullName)" /install 2>&1 | Out-String
            $code = if ($LASTEXITCODE -ne $null) { [int]$LASTEXITCODE } else { 0 }
            $codes += $code
            if ($out -match '(?:Added driver packages|Paquetes de controlador(?:es)? agregados)\s*:\s*(\d+)') {
                $added += [int]$Matches[1]
            }
            $chunks += ("[" + $inf.Name + "] exit " + $code + "`r`n" + $out.Trim())
        }

        $hardErrors = @($codes | Where-Object { $_ -ne 0 -and $_ -ne 3010 -and $_ -ne 1641 -and $_ -ne 259 })
        $reboot = @($codes | Where-Object { $_ -eq 3010 -or $_ -eq 1641 }).Count -gt 0
        $noDevice = @($codes | Where-Object { $_ -eq 259 }).Count -gt 0

        $entry.exitCode = ($codes | Select-Object -First 1)
        $entry.codes = $codes
        $entry.added = $added
        $entry.failed = $hardErrors.Count
        $entry.rebootRequired = $reboot
        $entry.infs = $targets.Count
        $entry.ok = ($hardErrors.Count -eq 0)
        if ($hardErrors.Count -gt 0) { $entry.status = 'error' }
        elseif ($reboot) { $entry.status = 'reboot' }
        elseif ($noDevice) { $entry.status = 'no-device' }
        else { $entry.status = 'ok' }
        $entry.output = ($chunks -join "`r`n`r`n")
    }
    catch {
        $entry.output = $_.Exception.Message
        $entry.ok = $false
        $entry.status = 'error'
    }
    $results += [pscustomobject]$entry
}

# Asks PnP to bind the packages that were just added to the driver store.
$scan = [ordered]@{ code = -1; output = '' }
try {
    $scanOut = & pnputil.exe /scan-devices 2>&1 | Out-String
    $scan.code = if ($LASTEXITCODE -ne $null) { [int]$LASTEXITCODE } else { 0 }
    $scan.output = $scanOut.Trim()
}
catch {
    $scan.output = $_.Exception.Message
}

try {
    $hardFailures = @($results | Where-Object { -not $_.ok }).Count
    $payload = [pscustomobject]@{
        ok             = ($hardFailures -eq 0)
        rebootRequired = (@($results | Where-Object { $_.rebootRequired }).Count -gt 0)
        scanDevices    = [pscustomobject]$scan
        results        = @($results)
    }
    $payload | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath $OutFile -Encoding UTF8
}
catch { }
