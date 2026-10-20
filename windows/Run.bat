@echo off
rem Starts Mortgage Management (the Desktop shortcut runs this).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
if errorlevel 1 pause
