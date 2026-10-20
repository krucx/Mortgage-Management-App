@echo off
rem Sets up Mortgage Management on this PC, or updates it: double-click to run.
rem It can be downloaded on its own; it then fetches setup.ps1 from GitHub.
setlocal
set "HERE=%~dp0"
if exist "%HERE%setup.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%setup.ps1" %*
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $f = Join-Path $env:TEMP 'mortgage-management-setup.ps1'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/krucx/Mortgage-Management-App/main/windows/setup.ps1' -OutFile $f; & $f %*; exit $LASTEXITCODE"
)
echo.
pause
