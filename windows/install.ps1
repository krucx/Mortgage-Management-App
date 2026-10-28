<#
Installs Mortgage Management from the code it sits in (run by setup.ps1): chooses Docker
or local, writes the .env (kept as it is when there already is one), installs what the
chosen way needs, and puts a shortcut on the Desktop.

  docker  Docker is installed: pulls the published images.
  local   No Docker: Node (winget) and uv (its own installer, with Python), then the
          backend's packages and the built UI.

Windows PowerShell 5.1 compatible, and ASCII only.
#>
param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [ValidateSet('auto', 'docker', 'local')][string]$Mode = 'auto',
    [switch]$NonInteractive
)

. (Join-Path $PSScriptRoot 'common.ps1')

function Read-Password {
    <# A Backup password typed twice (Enter for none). #>
    while ($true) {
        $first = Read-Host 'Backup password (Enter for none)' -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first))
        if ($plain -eq '') { return '' }
        if (-not (Test-PasswordWritable $plain)) {
            Write-Host "A Backup password can't contain a single quote ('). Try another." -ForegroundColor Red
            continue
        }
        $again = Read-Host 'The same password again' -AsSecureString
        $second = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($again))
        if ($plain -eq $second) { return $plain }
        Write-Host "The two didn't match. Try again." -ForegroundColor Red
    }
}

function Initialize-EnvFile {
    <# A .env for `Mode`, asking for the data and Backup folders (and, with Docker, a password). #>
    param([string]$Mode, [string]$InstallDir, [bool]$NonInteractive)
    if (Test-Path (Get-EnvPath)) {
        $text = Set-EnvValue ([IO.File]::ReadAllText((Get-EnvPath))) 'RUN_WITH' $Mode
        if ($Mode -eq 'local' -and (Read-EnvText $text)['BACKUP_PASSWORD']) {
            # Without Docker there is no zip program to make password zips with.
            Write-Host 'Without Docker, Backups are plain zips: the Backup password is cleared.' -ForegroundColor Yellow
            $text = Set-EnvValue $text 'BACKUP_PASSWORD' "''"
        }
        Write-EnvFile $text
        return
    }
    $dataDir = Join-Path $InstallDir 'data'
    $backupDir = Join-Path $InstallDir 'backups'
    $password = ''
    if (-not $NonInteractive) {
        Write-Host ''
        Write-Host 'The data folder holds the database and photos. Choose a folder with enough space for your records.'
        $chosen = Read-Host "Data folder (Enter for $dataDir)"
        if ($chosen) { $dataDir = $chosen.Trim('"', ' ') }
        Write-Host 'Backups can go to a Google Drive or OneDrive folder, so they are kept off this PC.'
        $chosen = Read-Host "Backup folder (Enter for $backupDir)"
        if ($chosen) { $backupDir = $chosen.Trim('"', ' ') }
        if ($Mode -eq 'docker') {
            $password = Read-Password
            if ($password) { Write-Host 'Write the Backup password down somewhere safe: a Backup cannot be opened without it.' -ForegroundColor Yellow }
        } else {
            Write-Host 'Without Docker, Backups are plain zips (no password).'
        }
    }
    New-Item -ItemType Directory -Force $dataDir, $backupDir | Out-Null
    Write-EnvFile (New-EnvText -Mode $Mode -DataDir $dataDir -BackupDir $backupDir -Password $password)
}

function Install-Docker {
    Start-DockerDesktop
    Write-Host 'Downloading the app (Docker images)...'
    Push-Location $AppDir
    try {
        & docker compose pull
        Assert-Success 'Downloading the Docker images'
    } finally { Pop-Location }
}

function Install-Local {
    if (-not (Test-Command node)) {
        if (-not (Test-Command winget)) {
            throw 'winget is missing: install "App Installer" from the Microsoft Store, then run setup again.'
        }
        Write-Host 'Installing Node.js (Windows may ask for permission)...'
        & winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-source-agreements --accept-package-agreements
        Assert-Success 'Installing Node.js'
        Update-SessionPath
    }
    if (-not (Test-Command uv)) {
        Write-Host 'Installing uv (it also brings the right Python)...'
        & powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://astral.sh/uv/install.ps1 | iex'
        Assert-Success 'Installing uv'
        Update-SessionPath
    }
    Write-Host 'Installing the backend...'
    Push-Location (Join-Path $AppDir 'backend')
    try {
        & uv sync --frozen --no-dev
        Assert-Success 'Installing the backend (uv sync)'
    } finally { Pop-Location }
    Write-Host 'Building the app screens...'
    Push-Location (Join-Path $AppDir 'frontend')
    try {
        & npm ci --no-audit --no-fund
        Assert-Success 'Installing the UI packages (npm ci)'
        & npm run build
        Assert-Success 'Building the UI (npm run build)'
    } finally { Pop-Location }
}

function New-DesktopShortcut {
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Get-ShortcutPath))
    $shortcut.TargetPath = Join-Path $PSScriptRoot 'Run.bat'
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.IconLocation = (Join-Path $PSScriptRoot 'MortgageManagement.ico') + ',0'
    $shortcut.Description = 'Start Mortgage Management'
    $shortcut.Save()
}

if ($MyInvocation.InvocationName -ne '.') {
    $chosen = Select-Mode -Requested $Mode -DockerInstalled (Test-Command docker)
    if ($chosen -eq 'docker') {
        Write-Host 'Docker is installed: the app will run in Docker.'
    } else {
        Write-Host 'Docker is not installed: the app will run directly on this PC.'
    }
    Initialize-EnvFile -Mode $chosen -InstallDir $InstallDir -NonInteractive:$NonInteractive
    if ($chosen -eq 'docker') { Install-Docker } else { Install-Local }
    New-DesktopShortcut

    Write-Host ''
    Write-Host 'Mortgage Management is set up.' -ForegroundColor Green
    Write-Host 'Start it any time with the "Mortgage Management" shortcut on the Desktop.'
    Write-Host 'Run Setup again to update to the newest release.'
    if (-not $NonInteractive) {
        $start = Read-Host 'Start it now? [Y/n]'
        if ($start -eq '' -or $start -match '^[Yy]') { & (Join-Path $PSScriptRoot 'run.ps1') }
    }
}
