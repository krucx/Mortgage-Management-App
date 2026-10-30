@echo off
rem Sets up Mortgage Management on this PC, or updates it: double-click to run.
rem It can be downloaded on its own; it then fetches setup.ps1 from GitHub, and without
rem internet starts the version already installed. That fallback repeats setup.ps1's offline
rem path (Main), as setup.ps1 can't be had offline: keep the two in step.
setlocal
set "HERE=%~dp0"
rem Out of the app's folder, which an update may move (it would hold this window's folder).
cd /d "%TEMP%"
if exist "%HERE%setup.ps1" goto beside
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $f = Join-Path $env:TEMP 'mortgage-management-setup.ps1'; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 'https://raw.githubusercontent.com/krucx/Mortgage-Management-App/main/windows/setup.ps1' -OutFile $f } catch { if ($_.Exception.Response) { throw }; $app = Join-Path $env:USERPROFILE 'MortgageManagement\app'; if (-not (Test-Path (Join-Path $app '.env'))) { Write-Host 'GitHub cannot be reached, and the first setup needs internet: connect, then run Setup again.' -ForegroundColor Red; exit 1 }; $v = 'unknown'; try { $v = (Get-Content -Raw (Join-Path $app 'frontend\package.json') | ConvertFrom-Json).version } catch {}; Write-Host ('Offline: starting the version you have (' + $v + ')') -ForegroundColor Yellow; & (Join-Path $app 'windows\run.ps1'); exit $LASTEXITCODE }; & $f %*; exit $LASTEXITCODE"
goto done
:beside
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%setup.ps1" %*
:done
echo.
pause
