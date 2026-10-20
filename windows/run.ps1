<#
Starts Mortgage Management the way setup chose (RUN_WITH in .env) and opens it.

  docker  Starts the Docker stack, which keeps running after this window closes.
  local   Starts the backend and the app's screens from this window; closing the
          window stops them.

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
    Push-Location $AppDir
    try {
        & docker compose up -d
        Assert-Success 'Starting the app (docker compose up)'
    } finally { Pop-Location }
    if (-not (Wait-Url $url 180)) { throw "The app did not answer at $url." }
    Open-App
    Write-Host "Mortgage Management is running at $url (in Docker)." -ForegroundColor Green
    Write-Host 'It keeps running after this window closes.'
}

function Start-Locally {
    Update-SessionPath
    $python = Join-Path $AppDir 'backend\.venv\Scripts\python.exe'
    if (-not (Test-Path $python)) { throw 'The backend is not installed: run Setup again.' }
    if (Wait-Url "http://127.0.0.1:$port" 2) {
        Write-Host "Mortgage Management is already running at $url."
        Open-App
        return
    }
    # The backend reads its folders from these, as it does in Docker.
    $env:DATA_DIR = $settings['DATA_DIR']
    $env:BACKUP_DIR = $settings['BACKUP_DIR']
    $env:BACKUP_PASSWORD = $settings['BACKUP_PASSWORD']

    Write-Host 'Starting Mortgage Management...'
    # The server itself (not through uv), so stopping it here really stops it.
    $backend = Start-Process -FilePath $python -NoNewWindow -PassThru `
        -WorkingDirectory (Join-Path $AppDir 'backend') `
        -ArgumentList '-m', 'uvicorn', 'mortgage_backend.main:app', '--host', '127.0.0.1', '--port', '8000'
    $screens = $null
    try {
        # Starting can take a while: a database update takes a Backup first.
        if (-not (Wait-Url 'http://127.0.0.1:8000/api/backups' 300)) {
            throw 'The backend did not start (see the messages above).'
        }
        # The built app, with /api passed on to the backend (vite.config.ts).
        $screens = Start-Process -FilePath (Get-Command node).Source -NoNewWindow -PassThru `
            -WorkingDirectory (Join-Path $AppDir 'frontend') `
            -ArgumentList 'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1',
            '--port', $port, '--strictPort'
        if (-not (Wait-Url "http://127.0.0.1:$port" 60)) {
            throw 'The app screens did not start (see the messages above).'
        }
        Open-App
        Write-Host ''
        Write-Host "Mortgage Management is running at $url." -ForegroundColor Green
        Write-Host 'Keep this window open while you use it; close it to stop the app.'
        Wait-Process -Id $screens.Id
    } finally {
        foreach ($process in @($screens, $backend)) {
            if ($process -and -not $process.HasExited) {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

try {
    if (-not (Test-Path (Get-EnvPath))) {
        throw 'Mortgage Management is not set up yet: run Setup first.'
    }
    $settings = Read-EnvFile
    $port = if ($settings['APP_PORT']) { $settings['APP_PORT'] } else { '8080' }
    $url = "http://localhost:$port"
    $mode = Select-Mode -Requested $settings['RUN_WITH'] -DockerInstalled (Test-Command docker)
    if ($mode -eq 'docker') { Start-WithDocker } else { Start-Locally }
} catch {
    Write-Host ''
    Write-Host "Mortgage Management could not start: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
