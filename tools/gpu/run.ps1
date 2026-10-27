# Runs a GPU scenario inside the interactive desktop session (needed: the SSH/service session has no GPU) and waits for it to finish.
# usage (on the Windows PC):  powershell -File C:\Users\ifix4\rp\run.ps1 fps
param([string]$Scenario = 'fps', [int]$TimeoutSec = 150)
$d = 'C:\Users\ifix4\rp'; Set-Location $d
$out = "$d\out_$Scenario.txt"; $done = "$d\done_$Scenario.txt"
Remove-Item $out, $done -ErrorAction SilentlyContinue
Remove-Item "$d\shots\$Scenario*" -ErrorAction SilentlyContinue
# wrapper: run node, then drop a marker with its exit code
$cmd = "$d\job_$Scenario.cmd"
Set-Content $cmd "@echo off`r`ncd /d $d`r`n`"C:\Program Files\nodejs\node.exe`" gpu.mjs $Scenario shots > `"$out`" 2>&1`r`necho %errorlevel% > `"$done`""
$name = 'rpgpu_' + $Scenario + '_' + (Get-Random)
schtasks /Create /TN $name /TR "`"$cmd`"" /SC ONCE /ST 23:59 /RU ifix4 /IT /F 2>&1 | Out-Null
schtasks /Run /TN $name 2>&1 | Out-Null
$t = 0; while (-not (Test-Path $done) -and $t -lt $TimeoutSec) { Start-Sleep 2; $t += 2 }
schtasks /Delete /TN $name /F 2>&1 | Out-Null
if (Test-Path $done) { "exit code: $((Get-Content $done -Raw).Trim())  ($t s)" } else { "TIMEOUT after $TimeoutSec s"; Get-Process chrome, node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
if (Test-Path $out) { Get-Content $out }
Get-ChildItem "$d\shots" -Filter "$Scenario*" -ErrorAction SilentlyContinue | ForEach-Object { "shot: $($_.Name)" }
