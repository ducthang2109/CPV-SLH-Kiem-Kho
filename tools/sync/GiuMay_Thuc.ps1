# Giu may tinh "thuc" 24/24 de OneDrive, tac vu dong bo va Power Automate (gateway / PAD) chay duoc.
# Khong cai them gi: chi dung PowerShell co san va API Windows SetThreadExecutionState
# (cung co che ma trinh phat video / PowerToys Awake dung). Khong doi chinh sach khoa man hinh cua IT.
# Chay:  GiuMay_Thuc.ps1              (giu may khong ngu; man hinh van tu tat + tu khoa -> an toan nhat)
#        GiuMay_Thuc.ps1 -Screen      (giu ca man hinh sang; chi dung khi PAD attended can man hinh)
#        GiuMay_Thuc.ps1 -Install [-Screen]  (tao tac vu tu chay an moi lan dang nhap)
#        GiuMay_Thuc.ps1 -Uninstall   (go tac vu, may tro lai che do tiet kiem dien binh thuong)
param([switch]$Screen, [switch]$Install, [switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$TaskName = 'CPV SLH Kiem Ke - Giu may thuc'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*GiuMay_Thuc.ps1*' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Write-Host 'Da go tac vu giu may thuc.'
  return
}

if ($Install) {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $a = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '"'
  if ($Screen) { $a += ' -Screen' }
  $conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
  if (Test-Path $conhost) { $action = New-ScheduledTaskAction -Execute $conhost -Argument ('--headless "' + $ps + '" ' + $a) }
  else { $action = New-ScheduledTaskAction -Execute $ps -Argument $a }
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Giu may khong ngu de dong bo OneDrive / Power Automate chay 24/24' -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Host ('Da cai tac vu "' + $TaskName + '" (chay an moi lan dang nhap). Kiem tra: powercfg /requests')
  return
}

Add-Type -Namespace CPV -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$ES_CONTINUOUS = [uint32]'0x80000000'; $ES_SYSTEM = [uint32]1; $ES_DISPLAY = [uint32]2
$flags = $ES_CONTINUOUS -bor $ES_SYSTEM
if ($Screen) { $flags = $flags -bor $ES_DISPLAY }
try {
  # Goi lai moi phut cho chac (yeu cau het hieu luc ngay khi tien trinh nay tat)
  while ($true) { [void][CPV.Power]::SetThreadExecutionState($flags); Start-Sleep -Seconds 60 }
} finally { [void][CPV.Power]::SetThreadExecutionState($ES_CONTINUOUS) }
