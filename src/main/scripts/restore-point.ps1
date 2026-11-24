param(
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Continue'
$result = [ordered]@{ ok = $false; output = '' }

try {
    $drive = "$env:SystemDrive\"
    & Enable-ComputerRestore -Drive $drive -ErrorAction Stop | Out-Null
    $lines = & Checkpoint-Computer -Description 'Snap Drivers Pro' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop 2>&1 | Out-String
    $result.output = $lines.Trim()
    $result.ok = $true
}
catch {
    $result.output = $_.Exception.Message
}

try {
    $result | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $OutFile -Encoding UTF8
}
catch { }
