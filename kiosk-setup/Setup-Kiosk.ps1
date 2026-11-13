# ---------------------------------------------------------------------------
# VaultPrint Kiosk Setup — turns a rooted Android box into a VaultPrint kiosk.
#
# Double-click "Setup VaultPrint Kiosk.bat". You need:
#   * the box on the same Wi-Fi as this PC (or connected by USB), with
#     USB/network debugging on
#   * the printer plugged into the box and switched on
#   * the kiosk's ID and API key from the admin panel (Kiosks → Add kiosk)
#
# Safe to run again on a kiosk that is already set up (it updates it).
# ---------------------------------------------------------------------------

param(
  # Optional, for unattended runs; anything left out is asked on screen
  [string]$Device,
  [string]$KioskId,
  [string]$ApiKey,
  [string]$Pin,
  [switch]$NoPause
)

# Not 'Stop': adb writes harmless notices to stderr, which Windows PowerShell
# 5.1 would turn into fatal errors. Steps that must stop on error say so.
$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Split-Path -Parent $Here
$Tools = Join-Path $Here 'tools'
$ApiBase = 'https://vaultprint-kiosk.vercel.app'

# Official F-Droid builds (Termux and Termux:Boot must come from the same source)
$Apks = @(
  @{ Name = 'Termux';      Package = 'com.termux';      File = 'com.termux_1002.apk';      Version = '0.118.3'; Sha = 'e6265a57eb5ca363808488e3b01955958bed93bc0c8a0d281849b363b11027ec' },
  @{ Name = 'Termux:Boot'; Package = 'com.termux.boot'; File = 'com.termux.boot_1000.apk'; Version = '0.8.1';   Sha = '6f7cf9b94f539d3efd4af3544ff819947b49395275d8cfa7e5f80de14f3d9cf8' }
)

function Say($text, $color = 'White') { Write-Host $text -ForegroundColor $color }
function Ok($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Info($text) { Write-Host "  ...  $text" -ForegroundColor Gray }
function Stop-Setup($text) {
  Write-Host ""
  Write-Host "  SETUP STOPPED: $text" -ForegroundColor Red
  Write-Host ""
  if (-not $NoPause) { Read-Host "Press Enter to close" }
  exit 1
}

Clear-Host
Say ""
Say "  =============================================" Cyan
Say "            VaultPrint Kiosk Setup" Cyan
Say "  =============================================" Cyan
Say ""

# ── 1. adb ────────────────────────────────────────────────────────────────
Say "1. Getting the Android connection tool (adb)" Yellow
$Adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $Adb) {
  $Adb = Join-Path $Tools 'platform-tools\adb.exe'
  if (-not (Test-Path $Adb)) {
    Info "Downloading Google's Android platform tools (one time)..."
    New-Item -ItemType Directory -Force $Tools | Out-Null
    $zip = Join-Path $Tools 'platform-tools.zip'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip -UseBasicParsing -ErrorAction Stop
    Expand-Archive $zip -DestinationPath $Tools -Force -ErrorAction Stop
    Remove-Item $zip
  }
}
if (-not (Test-Path $Adb)) { Stop-Setup "could not get adb" }
function Adb { & $Adb @args 2>&1 }
Adb start-server | Out-Null
Ok "adb ready"

# ── 2. Find the box ───────────────────────────────────────────────────────
Say ""
Say "2. Looking for the Android box" Yellow
function Get-Boxes {
  (Adb devices) | Select-String '^\S+\s+device$' | ForEach-Object { ($_ -split '\s+')[0] }
}
if ($Device) { Adb connect $Device | Out-Null; Start-Sleep 1 }
$boxes = @(Get-Boxes)
if ($Device) { $boxes = @($boxes | Where-Object { $_ -eq $Device }) }
if ($boxes.Count -eq 0) {
  Info "Searching this Wi-Fi network (about 10 seconds)..."
  $subnets = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixLength -ge 16 } |
    ForEach-Object { ($_.IPAddress -split '\.')[0..2] -join '.' } | Select-Object -Unique
  foreach ($net in $subnets) {
    $tries = 1..254 | ForEach-Object {
      $c = New-Object System.Net.Sockets.TcpClient
      @{ Ip = "$net.$_"; Client = $c; Task = $c.ConnectAsync("$net.$_", 5555) }
    }
    Start-Sleep -Milliseconds 2500
    foreach ($t in $tries) {
      if ($t.Task.IsCompleted -and -not $t.Task.IsFaulted -and $t.Client.Connected) { Adb connect "$($t.Ip):5555" | Out-Null }
      $t.Client.Close()
    }
  }
  Start-Sleep 2
  $boxes = @(Get-Boxes)
}
if ($boxes.Count -eq 0) {
  Stop-Setup "no Android box found. Check it is switched on, on the same Wi-Fi as this PC, and that network (ADB) debugging is enabled in its Developer options."
}
$i = 1
$list = foreach ($b in $boxes) {
  $model = (Adb -s $b shell getprop ro.product.model | Out-String).Trim()
  $android = (Adb -s $b shell getprop ro.build.version.release | Out-String).Trim()
  [pscustomobject]@{ N = $i; Serial = $b; Model = $model; Android = $android }
  $i++
}
$list | ForEach-Object { Say ("   [{0}] {1}  ({2}, Android {3})" -f $_.N, $_.Model, $_.Serial, $_.Android) }
if ($list.Count -gt 1) {
  $pick = Read-Host "  Which box should become the kiosk? Type its number"
  $box = $list | Where-Object { "$($_.N)" -eq $pick.Trim() }
  if (-not $box) { Stop-Setup "no box number $pick" }
} else { $box = $list[0] }
$S = $box.Serial
Ok "Using $($box.Model) at $S"

$rootCheck = (Adb -s $S shell "su 0 id" | Out-String)
if ($rootCheck -notmatch 'uid=0') { Stop-Setup "this box is not rooted (su is missing), so it cannot run VaultPrint." }
Ok "Box is rooted"

# ── 3. Kiosk identity ─────────────────────────────────────────────────────
Say ""
Say "3. Kiosk details (from the admin panel: Kiosks -> Add kiosk)" Yellow
do {
  if (-not $KioskId) { $KioskId = Read-Host "  Kiosk ID" }
  $KioskId = $KioskId.Trim()
  $validId = $KioskId -match '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
  if (-not $validId) { Say "  That doesn't look like a Kiosk ID (e.g. 48ba7726-d4b6-440e-8f3e-9f3cb3cf3a66). Try again." Red; $KioskId = $null }
} until ($validId)
do {
  if (-not $ApiKey) { $ApiKey = Read-Host "  API key" }
  $ApiKey = $ApiKey.Trim()
  $validKey = $ApiKey -match '^[0-9a-fA-F]{64}$'
  if (-not $validKey) { Say "  The API key is 64 letters/numbers (0-9, a-f). Try again." Red; $ApiKey = $null }
} until ($validKey)

Info "Checking the details with the VaultPrint server..."
try {
  $r = Invoke-WebRequest "$ApiBase/api/kiosk/heartbeat" -Method Post -UseBasicParsing `
    -Headers @{ Authorization = "Bearer $ApiKey" } -ContentType 'application/json' -Body '{"os_platform":"android"}' -ErrorAction Stop
  $serverKiosk = ($r.Content | ConvertFrom-Json).kiosk_id
} catch { Stop-Setup "the server did not accept this API key. Copy it again from the admin panel." }
if ($serverKiosk -and $serverKiosk -ne $KioskId) { Stop-Setup "this API key belongs to a different kiosk ($serverKiosk)." }
Ok "Kiosk details accepted"

if (-not $Pin) { $Pin = (Read-Host "  Staff PIN for unlocking the kiosk screen (4-8 digits, Enter = make one)").Trim() }
if (-not $Pin) { $Pin = -join ((1..6) | ForEach-Object { Get-Random -Minimum 0 -Maximum 10 }) }
if ($Pin -notmatch '^\d{4,8}$') { Stop-Setup "the staff PIN must be 4 to 8 digits" }

# ── 4. Apps ───────────────────────────────────────────────────────────────
Say ""
Say "4. Installing the Termux apps" Yellow
$apkDir = Join-Path $Tools 'apks'
New-Item -ItemType Directory -Force $apkDir | Out-Null
foreach ($a in $Apks) {
  $installed = (Adb -s $S shell "dumpsys package $($a.Package) | grep -m1 versionName" | Out-String)
  if ($installed -match [regex]::Escape($a.Version)) { Ok "$($a.Name) already installed"; continue }
  $f = Join-Path $apkDir $a.File
  if (-not (Test-Path $f) -or (Get-FileHash $f -Algorithm SHA256).Hash -ne $a.Sha.ToUpper()) {
    Info "Downloading $($a.Name) from F-Droid..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest "https://f-droid.org/repo/$($a.File)" -OutFile $f -UseBasicParsing -ErrorAction Stop
    if ((Get-FileHash $f -Algorithm SHA256).Hash -ne $a.Sha.ToUpper()) { Remove-Item $f; Stop-Setup "$($a.Name) download was corrupted. Run setup again." }
  }
  Info "Installing $($a.Name)..."
  $out = (Adb -s $S install -r $f | Out-String)
  if ($out -notmatch 'Success') { Stop-Setup "could not install $($a.Name): $out" }
  Ok "$($a.Name) installed"
}

# ── 5. Copy the software ──────────────────────────────────────────────────
Say ""
Say "5. Copying the VaultPrint software to the box" Yellow
$stage = Join-Path ([IO.Path]::GetTempPath()) ("vaultprint-setup-" + [guid]::NewGuid().ToString('N'))
$agentSrc = Join-Path $Repo 'agent'
New-Item -ItemType Directory -Force "$stage\agent\printers", "$stage\agent\android\boot", "$stage\agent\node_modules", "$stage\prebuilt" | Out-Null
Copy-Item "$agentSrc\agent.js", "$agentSrc\package.json" "$stage\agent\"
Copy-Item "$agentSrc\printers\*.js" "$stage\agent\printers\"
Copy-Item "$agentSrc\android\*.sh" "$stage\agent\android\"
Copy-Item "$agentSrc\android\boot\start-vaultprint" "$stage\agent\android\boot\"
Copy-Item "$agentSrc\node_modules\dotenv" "$stage\agent\node_modules\" -Recurse
Copy-Item "$agentSrc\android\prebuilt\*" "$stage\prebuilt\" -Recurse
Copy-Item "$agentSrc\android\install.sh" "$stage\install.sh"
# Shell scripts must have Unix line endings on Android
Get-ChildItem $stage -Recurse -Include *.sh, start-vaultprint | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName) -replace "`r`n", "`n"
  [IO.File]::WriteAllText($_.FullName, $t)
}
$cfg = "KIOSK_ID=$KioskId`nKIOSK_API_KEY=$ApiKey`nKIOSK_API_BASE_URL=$ApiBase`nSTAFF_PIN=$Pin`n"
[IO.File]::WriteAllText("$stage\config.env", $cfg)

Adb -s $S shell "rm -rf /data/local/tmp/vaultprint-setup" | Out-Null
$push = (Adb -s $S push "$stage" /data/local/tmp/vaultprint-setup | Out-String)
Remove-Item $stage -Recurse -Force
if ($push -notmatch 'pushed') { Stop-Setup "could not copy files to the box: $push" }
Ok "Software copied"

# ── 6. Install on the box ─────────────────────────────────────────────────
Say ""
Say "6. Setting up the kiosk (first setup takes 5-10 minutes - keep the box on)" Yellow
$result = $null
& $Adb -s $S shell "su 0 sh /data/local/tmp/vaultprint-setup/install.sh" 2>&1 | ForEach-Object {
  $line = "$_".Trim()
  if ($line -match '^STEP (\d+)/(\d+) (.*)$') { Info ("[{0}/{1}] {2}" -f $Matches[1], $Matches[2], $Matches[3]) }
  elseif ($line -match '^RESULT (.*)$') { $script:result = $Matches[1] }
}
if (-not $result -or $result -notmatch '^OK') { Stop-Setup ("the box reported: " + ($result -replace '^FAIL ', '')) }

Say ""
Say "  =============================================" Green
Say "     DONE - this box is now a VaultPrint kiosk" Green
Say "  =============================================" Green
Say ""
Say ("  " + ($result -replace '^OK ', ''))
Say ""
Say "  Staff PIN (hold the VaultPrint logo for 5 seconds on the kiosk screen): $Pin" Yellow
Say "  Write the PIN down - it is not shown again."
Say ""
Say "  The kiosk screen opens by itself within a minute, and again after every"
Say "  power cut (about 2-3 minutes after the box powers on)."
Say ""
if (-not $NoPause) { Read-Host "Press Enter to close" }
