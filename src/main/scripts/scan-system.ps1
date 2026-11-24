$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$warnings = New-Object System.Collections.ArrayList

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

# --- Class GUID -> class key map (from registry, language independent) ---
$guidToClass = @{}
$classRoot = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class'
Get-ChildItem $classRoot -ErrorAction SilentlyContinue | ForEach-Object {
    $g = $_.PSChildName
    if ($g -match '^\{[0-9a-fA-F-]+\}$') {
        $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
        $cls = $props.'Class'
        if (-not $cls) { $cls = $props.'(default)' }
        if ($cls) { $guidToClass[$g.ToLowerInvariant()] = $cls }
    }
}

# --- Hardware entities: hardware ids, status, problem codes ---
$entities = @{}
$entityErrors = $null
Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue -ErrorVariable entityErrors | ForEach-Object {
    if ($_.DeviceID) { $entities[$_.DeviceID.ToUpperInvariant()] = $_ }
}
if ($entityErrors) { $null = $warnings.Add('No se pudieron leer todos los dispositivos PnP: ' + ($entityErrors[0].ToString())) }
if ($entities.Count -eq 0) { $null = $warnings.Add('Windows no devolvió ningún dispositivo PnP; el resultado puede estar incompleto.') }

$drivers = New-Object System.Collections.ArrayList
$driverDeviceIds = New-Object 'System.Collections.Generic.HashSet[string]'
$seen = @{}
$rows = Get-CimInstance -ClassName Win32_PnPSignedDriver -ErrorAction SilentlyContinue |
    Where-Object { $_.DeviceID -or $_.DeviceName }

foreach ($d in $rows) {
    $deviceId = [string]$d.DeviceID
    if (-not $deviceId) { continue }
    $inf = [string]$d.InfName
    $ver = [string]$d.DriverVersion
    $dedupeKey = ($deviceId + '|' + $inf + '|' + $ver).ToUpperInvariant()
    if ($seen.ContainsKey($dedupeKey)) { continue }
    $seen[$dedupeKey] = 1
    $null = $driverDeviceIds.Add($deviceId.ToUpperInvariant())

    $entity = $entities[$deviceId.ToUpperInvariant()]
    $hw = @()
    if ($entity -and $entity.HardwareID) { $hw = @($entity.HardwareID) }
    if ($hw.Count -eq 0 -and $d.HardWareID) { $hw = @($d.HardWareID) }
    $hw = @($hw | ForEach-Object { [string]$_ } | Where-Object { $_ } | Select-Object -Unique)

    $classKey = [string]$d.DeviceClass
    if (-not $classKey -and $d.ClassGuid) { $classKey = $guidToClass[([string]$d.ClassGuid).ToLowerInvariant()] }
    if (-not $classKey -and $d.ClassGuid) { $classKey = [string]$d.ClassGuid }
    if (-not $classKey) { $classKey = 'Desconocida' }

    $deviceName = [string]$d.DeviceName
    if (-not $deviceName -and $entity -and $entity.Name) { $deviceName = [string]$entity.Name }
    if (-not $deviceName) { $deviceName = [string]$d.FriendlyName }
    if (-not $deviceName) { $deviceName = '(sin nombre)' }

    $errCode = 0
    if ($entity -and $entity.ConfigManagerErrorCode -ne $null) { $errCode = [int]$entity.ConfigManagerErrorCode }

    $null = $drivers.Add([pscustomobject]@{
        deviceName    = $deviceName
        deviceId      = $deviceId
        classKey      = $classKey
        classGuid     = [string]$d.ClassGuid
        provider      = [string]$d.DriverProviderName
        manufacturer  = [string]$d.Manufacturer
        driverVersion = $ver
        driverDate    = (Convert-DateValue $d.DriverDate)
        installDate   = (Convert-DateValue $d.InstallDate)
        infName       = $inf
        isSigned      = [bool]$d.IsSigned
        signer        = [string]$d.Signer
        status        = [string]$d.Status
        errorCode     = $errCode
        hardwareIds   = $hw
        isSoftware    = [bool](($deviceId -match '^(ROOT|SWD|SW\\|ACPI\\PNP0C|HTREE|STORAGE\\VOLUME|SCSI\\)' ) -or ($hw.Count -eq 0))
        isPresent     = [bool]($entity -ne $null)
    })
}

# --- Devices with problems (often no driver installed at all) ---
$problems = New-Object System.Collections.ArrayList
Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue |
    Where-Object { $_.ConfigManagerErrorCode -ne $null -and $_.ConfigManagerErrorCode -ne 0 } |
    ForEach-Object {
        $classKey = [string]$_.ClassGuid
        if ($guidToClass.ContainsKey([string]$_.ClassGuid)) { $classKey = $guidToClass[[string]$_.ClassGuid] }
        $hw = @()
        if ($_.HardwareID) { $hw = @($_.HardwareID | ForEach-Object { [string]$_ } | Where-Object { $_ } | Select-Object -Unique) }
        if ($driverDeviceIds.Contains(([string]$_.DeviceID).ToUpperInvariant())) { return }
        $null = $problems.Add([pscustomobject]@{
            deviceName  = [string]$_.Name
            deviceId    = [string]$_.DeviceID
            classKey    = $classKey
            status      = [string]$_.Status
            errorCode   = [int]$_.ConfigManagerErrorCode
            hardwareIds = $hw
        })
    }

# --- System summary ---
$csp = Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction SilentlyContinue
$board = Get-CimInstance -ClassName Win32_BaseBoard -ErrorAction SilentlyContinue
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
    $null = $warnings.Add('PowerShell está en modo de lenguaje restringido (' + $ExecutionContext.SessionState.LanguageMode + '): algunas consultas pueden fallar.')
}

$system = [pscustomobject]@{}
$os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
$cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
$bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction SilentlyContinue
$cpu = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue

$system = [pscustomobject]@{
    computerName   = [string]$env:COMPUTERNAME
    manufacturer   = [string]$cs.Manufacturer
    model          = [string]$cs.Model
    productVersion = [string]$csp.Version
    serial         = [string]$csp.IdentifyingNumber
    boardVendor    = [string]$board.Manufacturer
    boardProduct   = [string]$board.Product
    biosDate       = (Convert-DateValue $bios.ReleaseDate)
    cpu            = ([string]$cpu.Name).Trim()
    biosVersion    = [string]$bios.SMBIOSBIOSVersion
    osCaption      = [string]$os.Caption
    osVersion      = [string]$os.Version
    osBuild        = [string]$os.BuildNumber
    displayVersion = [string]$cv.DisplayVersion
    ubr            = [int]$cv.UBR
    architecture   = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    ramGb          = if ($cs.TotalPhysicalMemory) { [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) } else { 0 }
    isAdmin        = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($drivers.Count -eq 0) {
    $null = $warnings.Add('No se pudo enumerar ningún controlador (Win32_PnPSignedDriver devolvió 0 filas).')
}

$hw = [ordered]@{}
$hw.cpu = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ name = ([string]$_.Name).Trim(); vendor = [string]$_.Manufacturer; version = ''; extra = "$($_.NumberOfCores) núcleos · $($_.NumberOfLogicalProcessors) hilos · $($_.MaxClockSpeed) MHz" }
})
$hw.gpu = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ name = ([string]$_.Name).Trim(); vendor = [string]$_.AdapterCompatibility; version = [string]$_.DriverVersion; extra = ([string]$_.VideoProcessor).Trim() }
})
$hw.audio = @(Get-CimInstance -ClassName Win32_SoundDevice -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ name = ([string]$_.Name).Trim(); vendor = [string]$_.Manufacturer; version = ''; extra = [string]$_.Status }
})
$hw.network = @(Get-CimInstance -ClassName Win32_NetworkAdapter -ErrorAction SilentlyContinue | Where-Object { $_.PhysicalAdapter } | ForEach-Object {
    [pscustomobject]@{ name = ([string]$_.Name).Trim(); vendor = [string]$_.Manufacturer; version = ''; extra = ("$([string]$_.MACAddress) · $([string]$_.AdapterType)").Trim(' ·') }
})
$hw.storage = @(Get-CimInstance -ClassName Win32_DiskDrive -ErrorAction SilentlyContinue | ForEach-Object {
    $size = if ($_.Size) { [math]::Round($_.Size / 1GB, 1) } else { 0 }
    [pscustomobject]@{ name = ([string]$_.Model).Trim(); vendor = [string]$_.Manufacturer; version = [string]$_.InterfaceType; extra = "$size GB · $([string]$_.MediaType)" }
})
$hw.memory = @(Get-CimInstance -ClassName Win32_PhysicalMemory -ErrorAction SilentlyContinue | ForEach-Object {
    $size = if ($_.Capacity) { [math]::Round($_.Capacity / 1GB, 0) } else { 0 }
    [pscustomobject]@{ name = ([string]$_.PartNumber).Trim(); vendor = [string]$_.Manufacturer; version = ''; extra = "$size GB · $($_.Speed) MHz" }
})
$hw.battery = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ name = ([string]$_.Name).Trim(); vendor = ''; version = ''; extra = ("estado $($_.BatteryStatus) · $($_.EstimatedChargeRemaining)%") }
})

$sw.Stop()
$result = [pscustomobject]@{
    generatedAt = (Get-Date).ToString('o')
    durationMs  = [int]$sw.ElapsedMilliseconds
    system      = $system
    drivers     = @($drivers)
    problems    = @($problems)
    hardware    = $hw
    warnings    = @($warnings)
}

[Console]::Out.Write(($result | ConvertTo-Json -Depth 6 -Compress))
