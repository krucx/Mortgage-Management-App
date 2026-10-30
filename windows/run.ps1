<#
Starts Mortgage Management the way setup chose (RUN_WITH in .env) and opens it.

  docker  Starts the Docker stack, which keeps running after this window closes.
  local   Starts the backend, which serves the app's screens too, from this window;
          closing the window stops it.

Windows PowerShell 5.1 compatible, and ASCII only.
#>
param(
    # Start the app without opening it in the browser (for CI).
    [switch]$NoBrowser
)

. (Join-Path $PSScriptRoot 'common.ps1')

function Open-App {
    if (-not $NoBrowser) { Start-Process $url | Out-Null }
}

function Start-WithDocker {
    Start-DockerDesktop
    Invoke-AppCompose $AppDir 'Starting the app (docker compose up)' @('up', '-d')
    if (-not (Wait-Url $url 180)) { throw "The app did not answer at $url." }
    Open-App
    Write-Host "Mortgage Management is running at $url (in Docker)." -ForegroundColor Green
    Write-Host 'It keeps running after this window closes.'
}

function Start-Locally {
    Update-SessionPath
    $python = Join-Path $AppDir 'backend\.venv\Scripts\python.exe'
    if (-not (Test-Path $python)) { throw 'The backend is not installed: run Setup again.' }
    $screens = Join-Path $AppDir 'frontend\dist'
    if (-not (Test-Path (Join-Path $screens 'index.html'))) { throw 'The app screens are not built: run Setup again.' }
    if (Wait-Url "http://127.0.0.1:$port" 2) {
        Write-Host "Mortgage Management is already running at $url."
        Open-App
        return
    }
    # The backend reads its folders from these, as it does in Docker; and serves the screens
    # itself (nginx does in Docker), so nothing else needs to run.
    $env:DATA_DIR = $settings['DATA_DIR']
    $env:BACKUP_DIR = $settings['BACKUP_DIR']
    $env:BACKUP_PASSWORD = $settings['BACKUP_PASSWORD']
    $env:SCREENS_DIR = $screens
    $env:CHECK_FOR_UPDATES = 'true'

    Write-Host 'Starting Mortgage Management...'
    # The server itself (not through uv), so stopping it here really stops it.
    # 127.0.0.1, not localhost: on Windows localhost can mean IPv6.
    $backend = Start-Process -FilePath $python -NoNewWindow -PassThru `
        -WorkingDirectory (Join-Path $AppDir 'backend') `
        -ArgumentList '-m', 'uvicorn', 'mortgage_backend.main:app', '--host', '127.0.0.1', '--port', $port
    try {
        # Starting can take a while: a database update takes a Backup first.
        if (-not (Wait-Url "http://127.0.0.1:$port/api/backups" 300)) {
            throw 'The app did not start (see the messages above).'
        }
        Open-App
        Write-Host ''
        Write-Host "Mortgage Management is running at $url." -ForegroundColor Green
        Write-Host 'Keep this window open while you use it; close it to stop the app.'
        Wait-Process -Id $backend.Id
    } finally {
        if (-not $backend.HasExited) { Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue }
    }
}

try {
    if (-not (Test-Path (Get-EnvPath))) {
        throw 'Mortgage Management is not set up yet: run Setup first.'
    }
    $settings = Read-EnvFile
    $port = Get-AppPort $settings
    $url = "http://localhost:$port"
    $mode = Select-Mode -Requested $settings['RUN_WITH'] -DockerInstalled (Test-Command docker)
    if ($mode -eq 'docker') { Start-WithDocker } else { Start-Locally }
} catch {
    Write-Host ''
    Write-Host "Mortgage Management could not start: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
