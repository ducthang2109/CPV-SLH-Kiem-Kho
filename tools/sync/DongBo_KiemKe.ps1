# Dong bo 2 chieu giua may tinh (thu muc OneDrive "Apps Kiem Kho") va du lieu chung cua app CPV SLH Kiem Ke.
#  - Output: tai bien ban / bao cao / Excel moi tu repo du lieu ve "Apps Kiem Kho\Output\<nam>\<thang>\<so BB>\"
#            va xuat lich su kiem ra "Output\LichSu_KiemKe.csv". OneDrive tren may tu day len OneDrive cong ty.
#  - Input : day file ton kho, file Master trong "Apps Kiem Kho\Input" len du lieu chung de app lay ve.
# Ma ket noi (KK1...) luu ma hoa bang tai khoan Windows (DPAPI) trong %LOCALAPPDATA%\CPVKiemKe, khong nam trong OneDrive.
# Chay:  DongBo_KiemKe.ps1            (dong bo 1 lan, dung cho tac vu chay dinh ky)
#        DongBo_KiemKe.ps1 -Setup     (nhap ma ket noi, cai tac vu 15 phut/lan, dong bo lan dau)
#        DongBo_KiemKe.ps1 -Uninstall (go tac vu)
#        DongBo_KiemKe.ps1 -Watch     (chay nen: co file moi trong Input thi day len ngay)
#        DongBo_KiemKe.ps1 -InstallWatch (chi cai tac vu theo doi Input)
param([switch]$Setup, [switch]$Uninstall, [switch]$Watch, [switch]$InstallWatch, [string]$Root)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$TaskName = 'CPV SLH Kiem Ke - Dong bo OneDrive'
$WatchTaskName = 'CPV SLH Kiem Ke - Theo doi Input'
$Data = Join-Path $env:LOCALAPPDATA 'CPVKiemKe'
if (-not (Test-Path $Data)) { New-Item -ItemType Directory -Path $Data | Out-Null }
$CodeFile = Join-Path $Data 'ketnoi.dat'
$StateFile = Join-Path $Data 'state.json'
$LogFile = Join-Path $Data 'dongbo.log'
# Thu muc goc "Apps Kiem Kho": mac dinh la thu muc cha cua thu muc chua script (Apps Kiem Kho\DongBo\)
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$OutDir = Join-Path $Root 'Output'
$InDir = Join-Path $Root 'Input'
# Thu muc / file trong Input duoc day len (khong day anh, PDF bien ban cu...)
$InputDirs = @('Data Warehouse FG', 'Data SparePart Supplies', 'Data Package', 'Data check Branch')
$InputFiles = @('Master_NhaMay.xlsx')
$MaxUpload = 45MB

function Log($msg) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  if ((Get-Item $LogFile).Length -gt 2MB) { $keep = Get-Content $LogFile -Tail 2000 -Encoding UTF8; Set-Content $LogFile $keep -Encoding UTF8 }
}

function Read-Code($code) {
  $code = $code.Trim()
  if ($code -notmatch '^KK1\.(.+)$') { throw 'Ma ket noi khong dung (phai bat dau bang KK1.)' }
  $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1]))
  $o = $json | ConvertFrom-Json
  $b = 'main'; if ($o.b) { $b = $o.b }
  return @{ repo = $o.r; token = $o.t; branch = $b }
}
function Save-Code($code) {
  $null = Read-Code $code
  $sec = ConvertTo-SecureString $code -AsPlainText -Force
  ConvertFrom-SecureString $sec | Set-Content -Path $CodeFile -Encoding ASCII
}
function Load-Conn {
  if ($env:CPV_SYNC_CODE) { return Read-Code $env:CPV_SYNC_CODE }
  if (-not (Test-Path $CodeFile)) { return $null }
  $sec = (Get-Content $CodeFile -Raw).Trim() | ConvertTo-SecureString
  $code = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  return Read-Code $code
}

function Enc-Path($p) { ($p -split '/' | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/' }
function Api($method, $url, $body, $accept) {
  if (-not $accept) { $accept = 'application/vnd.github+json' }
  $h = @{ Authorization = 'Bearer ' + $script:conn.token; Accept = $accept; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'CPV-SLH-KiemKe-Sync' }
  $p = @{ Method = $method; Uri = 'https://api.github.com/repos/' + $script:conn.repo + $url; Headers = $h; UseBasicParsing = $true }
  if ($body) { $p.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 6 -Compress)); $p.ContentType = 'application/json; charset=utf-8' }
  return Invoke-RestMethod @p
}
function Download($path, $dest) {
  $dir = Split-Path -Parent $dest
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $h = @{ Authorization = 'Bearer ' + $script:conn.token; Accept = 'application/vnd.github.raw'; 'User-Agent' = 'CPV-SLH-KiemKe-Sync' }
  $tmp = $dest + '.tmp'
  Invoke-WebRequest -Uri ('https://api.github.com/repos/' + $script:conn.repo + '/contents/' + (Enc-Path $path) + '?ref=' + $script:conn.branch) -Headers $h -OutFile $tmp -UseBasicParsing
  Move-Item -Path $tmp -Destination $dest -Force
}
function Git-Sha([byte[]]$bytes) {
  $head = [Text.Encoding]::ASCII.GetBytes('blob ' + $bytes.Length + [char]0)
  $sha = [Security.Cryptography.SHA1]::Create()
  $all = New-Object byte[] ($head.Length + $bytes.Length)
  [Array]::Copy($head, 0, $all, 0, $head.Length); [Array]::Copy($bytes, 0, $all, $head.Length, $bytes.Length)
  return (($sha.ComputeHash($all) | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Load-State {
  if (Test-Path $StateFile) { try { return (Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { } }
  return [pscustomobject]@{ files = [pscustomobject]@{} }
}
function Set-Prop($obj, $name, $value) {
  if ($obj.PSObject.Properties[$name]) { $obj.$name = $value } else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

function Get-InputFiles {
  $local = @()
  foreach ($f in $InputFiles) { $p = Join-Path $InDir $f; if (Test-Path $p) { $local += Get-Item $p } }
  foreach ($d in $InputDirs) { $p = Join-Path $InDir $d; if (Test-Path $p) { $local += Get-ChildItem $p -File -Recurse | Where-Object { $_.Name -notlike '~$*' -and $_.Extension -match '^\.(xlsx|xls|pdf|csv)$' } } }
  return $local
}

function Sync-Once([switch]$InputOnly) {
  $script:conn = Load-Conn
  if (-not $script:conn) { Log 'Chua co ma ket noi. Chay CaiDat_DongBo.cmd de nhap ma.'; return }
  # Lan dong bo 15 phut va tac vu theo doi Input khong day Input cung luc (tranh loi 409)
  $im = New-Object Threading.Mutex($false, 'Global\CPVKiemKeInput')
  if (-not $im.WaitOne([TimeSpan]::FromMinutes(5))) { throw 'Dang co lan day Input khac chay qua lau' }
  try {
  $state = Load-State
  $tree = Api 'GET' ('/git/trees/' + $script:conn.branch + '?recursive=1')
  $blobs = @($tree.tree | Where-Object { $_.type -eq 'blob' })
  $remote = @{}; foreach ($b in $blobs) { $remote[$b.path] = $b }

  # ---------- Input: file ton, Master len du lieu chung (chay truoc de app co file moi ngay) ----------
  $local = Get-InputFiles
  $sent = 0; $index = @()
  foreach ($f in $local) {
    $rel = $f.FullName.Substring($InDir.Length + 1) -replace '\\', '/'
    $path = 'input/' + $rel
    $index += [ordered]@{ path = $path; name = $f.Name; folder = $(if ($rel.Contains('/')) { $rel.Substring(0, $rel.LastIndexOf('/')) } else { '' }); size = $f.Length; modified = $f.LastWriteTimeUtc.ToString('o') }
    if ($f.Length -gt $MaxUpload) { Log ('Bo qua file qua lon: ' + $rel); continue }
    $bytes = [IO.File]::ReadAllBytes($f.FullName)
    $sha = Git-Sha $bytes
    $r = $remote[$path]
    if ($r -and $r.sha -eq $sha) { continue }
    $body = @{ message = 'Dong bo Input: ' + $rel; content = [Convert]::ToBase64String($bytes); branch = $script:conn.branch }
    if ($r) { $body.sha = $r.sha }
    try { $null = Api 'PUT' ('/contents/' + (Enc-Path $path)) $body; $sent++; Log ('Day len: ' + $rel) } catch { Log ('Loi day ' + $rel + ': ' + $_.Exception.Message) }
  }
  # Danh muc file Input (ten, ngay sua) de app chon file moi nhat
  $idxJson = (@{ updatedAt = (Get-Date).ToUniversalTime().ToString('o'); files = $index } | ConvertTo-Json -Depth 5)
  $idxBytes = [Text.Encoding]::UTF8.GetBytes($idxJson)
  $old = $remote['input/_index.json']
  $oldKey = $state.PSObject.Properties['indexKey']
  $newKey = ($index | ForEach-Object { $_.path + '|' + $_.size + '|' + $_.modified }) -join ';'
  if (-not $old -or -not $oldKey -or $oldKey.Value -ne $newKey) {
    $body = @{ message = 'Danh muc Input'; content = [Convert]::ToBase64String($idxBytes); branch = $script:conn.branch }
    if ($old) { $body.sha = $old.sha }
    $null = Api 'PUT' '/contents/input/_index.json' $body
    Set-Prop $state 'indexKey' $newKey
  }
  } finally { $im.ReleaseMutex(); $im.Dispose() }
  if ($InputOnly) {
    ($state | ConvertTo-Json -Depth 6) | Set-Content -Path $StateFile -Encoding UTF8
    if ($sent) { Log ('Xong (theo doi Input): day len ' + $sent + ' file') }
    return
  }

  # ---------- Output: file ket qua ve OneDrive ----------
  $got = 0
  foreach ($b in $blobs | Where-Object { $_.path -like 'files/*' }) {
    $rel = $b.path.Substring(6)
    $dest = Join-Path $OutDir ($rel -replace '/', '\')
    $known = $state.files.PSObject.Properties[$b.path]
    if ((Test-Path $dest) -and $known -and $known.Value -eq $b.sha) { continue }
    try { Download $b.path $dest; Set-Prop $state.files $b.path $b.sha; $got++; Log ('Tai ve: ' + $rel) } catch { Log ('Loi tai ' + $rel + ': ' + $_.Exception.Message) }
  }

  # ---------- Lich su kiem -> CSV ----------
  $histBlobs = @($blobs | Where-Object { $_.path -like 'history/*.json' })
  $histKey = ($histBlobs | ForEach-Object { $_.sha }) -join ','
  $histState = $state.PSObject.Properties['historyKey']
  $csv = Join-Path $OutDir 'LichSu_KiemKe.csv'
  if ($histBlobs.Count -and (-not $histState -or $histState.Value -ne $histKey -or -not (Test-Path $csv))) {
    $rows = @()
    foreach ($h in $histBlobs) {
      $tmp = Join-Path $Data 'h.json'
      Download $h.path $tmp
      $j = [IO.File]::ReadAllText($tmp, [Text.Encoding]::UTF8) | ConvertFrom-Json
      foreach ($r in $j.records) {
        $s = $r.stats
        $files = ''; if ($r.files) { $files = ($r.files | ForEach-Object { $_.name }) -join '; ' }
        $rows += [pscustomobject][ordered]@{
          'Ngay' = $r.date; 'So bien ban' = $r.docNo; 'Loai kiem' = $r.type; 'Ma NM' = $r.factoryCode; 'Nha may' = $r.factory
          'Ke toan' = $r.user; 'Bat dau' = $r.start; 'Ket thuc' = $r.end; 'Trang thai' = $(if ($r.status -eq 'done') { 'Hoan tat' } else { 'Dang kiem' })
          'So dong / chi tieu' = $(if ($s.lines) { $s.lines } else { $s.total }); 'Dong lech' = $s.diff; 'Khong dat' = $s.fail; 'File' = $files
        }
      }
      Remove-Item $tmp -Force
    }
    if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
    $text = ($rows | Sort-Object 'Ngay' -Descending | ConvertTo-Csv -NoTypeInformation) -join "`r`n"
    [IO.File]::WriteAllText($csv, $text, (New-Object Text.UTF8Encoding $true))
    Set-Prop $state 'historyKey' $histKey
    Log ('Cap nhat lich su: ' + $rows.Count + ' lan kiem')
  }

  Set-Prop $state 'lastRun' (Get-Date).ToString('o')
  ($state | ConvertTo-Json -Depth 6) | Set-Content -Path $StateFile -Encoding UTF8
  Log ('Xong: tai ve ' + $got + ' file, day len ' + $sent + ' file')
}

function Install-WatchTask {
  # Tac vu chay an tu luc dang nhap, theo doi thu muc Input va day file moi len ngay
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $action = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '" -Watch -Root "' + $Root + '"')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $WatchTaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Theo doi thu muc Input, co file moi thi day len du lieu chung app CPV SLH Kiem Ke ngay' -Force | Out-Null
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName $WatchTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $WatchTaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host 'Da go tac vu dong bo.'
  return
}

if ($InstallWatch) {
  Install-WatchTask
  Start-ScheduledTask -TaskName $WatchTaskName
  Write-Host ('Da cai tac vu "' + $WatchTaskName + '".')
  return
}

if ($Watch) {
  # Kiem tra thu muc Input 5 giay/lan; file thay doi va dung yen 10 giay thi day len (chi Input, khong tai bien ban)
  $wm = New-Object Threading.Mutex($false, 'Global\CPVKiemKeWatch')
  if (-not $wm.WaitOne(0)) { return }
  Log 'Bat dau theo doi thu muc Input'
  $last = ''; $pending = $true; $changedAt = (Get-Date).AddSeconds(-60)
  while ($true) {
    Start-Sleep -Seconds 5
    try { $key = (Get-InputFiles | ForEach-Object { $_.FullName + '|' + $_.Length + '|' + $_.LastWriteTimeUtc.Ticks }) -join ';' } catch { continue }
    if ($key -ne $last) { $last = $key; $pending = $true; $changedAt = Get-Date; continue }
    if (-not $pending -or ((Get-Date) - $changedAt).TotalSeconds -lt 10) { continue }
    try { Sync-Once -InputOnly; $pending = $false }
    catch { Log ('LOI (theo doi Input): ' + $_.Exception.Message); $changedAt = (Get-Date).AddSeconds(50) }
  }
}

if ($Setup) {
  Write-Host ''
  Write-Host '=== CAI DAT DONG BO APP CPV SLH KIEM KE ===' -ForegroundColor Green
  Write-Host 'Mo app > Cai dat > Du lieu chung > "Lay ma ket noi cho may khac", sao chep ma KK1... roi dan vao day.'
  if (Test-Path $CodeFile) { Write-Host '(May nay da co ma. Nhan Enter de giu ma cu.)' }
  $code = Read-Host 'Ma ket noi'
  if ($code) { Save-Code $code; Write-Host 'Da luu ma ket noi (ma hoa theo tai khoan Windows nay).' -ForegroundColor Green }
  elseif (-not (Test-Path $CodeFile)) { throw 'Chua nhap ma ket noi.' }
  # Tac vu chay an moi 15 phut khi dang dang nhap Windows
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $action = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '" -Root "' + $Root + '"')
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
  $trigger2 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($trigger, $trigger2) -Settings $settings -Description 'Dong bo file Output/Input giua OneDrive va du lieu chung app CPV SLH Kiem Ke (15 phut/lan)' -Force | Out-Null
  Write-Host ('Da cai tac vu "' + $TaskName + '" chay 15 phut/lan.') -ForegroundColor Green
  Install-WatchTask
  Start-ScheduledTask -TaskName $WatchTaskName
  Write-Host ('Da cai tac vu "' + $WatchTaskName + '": co file moi trong Input se day len ngay.') -ForegroundColor Green
  Write-Host 'Dang dong bo lan dau...'
}

$mutex = New-Object Threading.Mutex($false, 'Global\CPVKiemKeSync')
if (-not $mutex.WaitOne(0)) { Log 'Dang co lan dong bo khac chay, bo qua.'; return }
try { Sync-Once } catch { Log ('LOI: ' + $_.Exception.Message) } finally { $mutex.ReleaseMutex() }
if ($Setup) { Write-Host ''; Write-Host ('Nhat ky: ' + $LogFile); Read-Host 'Nhan Enter de dong' | Out-Null }
