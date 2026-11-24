$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Convert-DateValue($v) {
    if ($null -eq $v) { return $null }
    if ($v -is [datetime]) { return $v.ToString('yyyy-MM-ddTHH:mm:ss') }
    $s = [string]$v
    if ($s -match '/Date\((-?\d+)\)/') {
        $ms = [int64]$Matches[1]
        return ([datetime]'1970-01-01T00:00:00Z').AddMilliseconds($ms).ToString('yyyy-MM-ddTHH:mm:ss')
    }
    $d = [datetime]::MinValue
    if ([datetime]::TryParse($s, [ref]$d)) { return $d.ToString('yyyy-MM-ddTHH:mm:ss') }
    return $null
}

$updates = New-Object System.Collections.ArrayList
$errorMessage = $null
$available = $false

try {
    $session = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    $searcher.ServerSelection = 2      # ssWindowsUpdate
    $searcher.SearchScope = 1          # only installed-machine applicable updates
    $searcher.Online = $true
    $result = $searcher.Search("IsInstalled=0 and Type='Driver'")
    $available = $true

    foreach ($u in $result.Updates) {
        $hw = @()
        if ($u.DriverHardwareID) { $hw = @($u.DriverHardwareID | ForEach-Object { [string]$_ } | Where-Object { $_ } | Select-Object -Unique) }
        $null = $updates.Add([pscustomobject]@{
            updateId       = [string]$u.Identity.UpdateID
            title          = [string]$u.Title
            model          = [string]$u.DriverModel
            provider       = [string]$u.DriverProvider
            manufacturer   = [string]$u.DriverManufacturer
            driverClass    = [string]$u.DriverClass
            driverDate     = (Convert-DateValue $u.DriverVerDate)
            sizeBytes      = [int64]$u.MaxDownloadSize
            revisionNumber = [int]$u.Identity.RevisionNumber
            isMandatory    = [bool]$u.IsMandatory
            rebootRequired = [bool]$u.RebootRequired
            hardwareIds    = $hw
        })
    }
}
catch {
    $errorMessage = $_.Exception.Message
}

$sw.Stop()
$payload = [pscustomobject]@{
    generatedAt = (Get-Date).ToString('o')
    durationMs  = [int]$sw.ElapsedMilliseconds
    available   = $available
    error       = $errorMessage
    updates     = @($updates)
}

[Console]::Out.Write(($payload | ConvertTo-Json -Depth 6 -Compress))
