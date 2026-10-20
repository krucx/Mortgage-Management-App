@echo off
rem Removes Mortgage Management from this PC: double-click to run. It keeps the latest
rem Backup in Documents first. It runs from %TEMP%, as Windows will not delete a folder a
rem window is in; and its last line does the rest, as cmd reads a .bat a line at a time and
rem this one is deleted while it runs.
cd /d "%TEMP%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %* & echo. & pause & exit /b
