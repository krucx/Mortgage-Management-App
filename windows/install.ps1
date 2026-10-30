<#
Installs Mortgage Management from the code it sits in (run by setup.ps1, which puts each
version in a folder of its own, InstallDir\versions\<version>): chooses Docker or local,
writes the .env (copied from the version running, kept as it is there), installs what the
chosen way needs, and puts a shortcut on the Desktop and registers the
mortgage-management:// link the installed app (PWA) starts it with.

InstallDir\app is a junction pointing at the version that runs. An update switches it to
this version only once this version has started and answers; until then, and if it never
does, the version before it keeps running.

  docker  Docker is installed: pulls the published images.
  local   No Docker: uv (its own installer, with Python) and the backend's packages. A
          release comes with its screens built; other code (a branch or commit) has them
          built here, with Node (winget).

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

function Copy-EnvForward {
    <# The .env of the version in `From`, copied into this one; that one is left as it is. #>
    param([string]$From)
    $source = Join-Path $From '.env'
    if ((Test-Path -LiteralPath $source) -and -not (Test-Path (Get-EnvPath))) {
        Copy-Item -LiteralPath $source (Get-EnvPath)
    }
}

function Install-Docker {
    Start-DockerDesktop
    Write-Host 'Downloading the app (Docker images)...'
    Invoke-AppCompose $AppDir 'Downloading the Docker images' @('pull')
}

function Install-Local {
    <# The backend's packages, and the screens built unless they came built (a release's
       ready-built download): then Node isn't needed at all. #>
    $built = Test-Path (Join-Path $AppDir 'frontend\dist\index.html')
    if (-not $built -and -not (Test-Command node)) {
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
    if ($built) { return }
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
    # Through InstallDir\app, so it starts whichever version runs.
    $windows = Join-Path $InstallDir 'app\windows'
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Get-ShortcutPath))
    $shortcut.TargetPath = Join-Path $windows 'Run.bat'
    $shortcut.WorkingDirectory = $windows
    $shortcut.IconLocation = (Join-Path $windows 'MortgageManagement.ico') + ',0'
    $shortcut.Description = 'Start Mortgage Management'
    $shortcut.Save()
}

# How long a version may take to start before an update gives up on it: starting Docker
# Desktop, or a database update (which takes a Backup first), can take a while.
$StartMinutes = 7

function Stop-RunningApp {
    <# Stop the app run from `Folder` the way it runs (`Mode`), so another version can start;
       with -Replaced, its Docker containers are left for the next one's to replace. Whether
       it is to be started again should the update fail: with Docker, always; without, if it
       was running. #>
    param([string]$Mode, [string]$Folder, [switch]$Replaced)
    if ($Mode -eq 'docker') {
        if (-not $Replaced) { Invoke-AppCompose $Folder 'Stopping the app (docker compose down)' @('down') }
        return $true
    }
    # Of whichever version: the window may have been started through InstallDir\app.
    $ids = Select-AppProcessIds -Processes @(Get-CimInstance Win32_Process) -Folder $InstallDir -Self $PID
    foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    if ($ids.Count -gt 0) { Start-Sleep -Seconds 2 }  # Windows lets go of their files a moment later
    return $ids.Count -gt 0
}

function Start-Version {
    <# Start the version in `Folder`: with Docker its images, replacing the containers of any
       other version; without, in a window of its own, as the Desktop shortcut does. #>
    param([string]$Folder, [string]$Mode)
    if ($Mode -eq 'docker') {
        Invoke-AppCompose $Folder 'Starting the app (docker compose up)' @('up', '-d')
    } else {
        $windows = Join-Path $Folder 'windows'
        Start-Process -FilePath (Join-Path $windows 'Run.bat') -ArgumentList '-NoBrowser' -WorkingDirectory $windows | Out-Null
    }
}

function Wait-Version {
    <# Whether the app answers on `Port` within $StartMinutes. #>
    param([string]$Port)
    return Wait-Url "http://127.0.0.1:$Port/api/backups" ($StartMinutes * 60)
}

function Find-UpdateBackup {
    <# The Backup the app takes before it updates the database, if it took one since `Since`. #>
    param([string]$BackupDir, [datetime]$Since)
    if (-not $BackupDir -or -not (Test-Path -LiteralPath $BackupDir)) { return $null }
    return Get-ChildItem -LiteralPath $BackupDir -File -Filter 'mortgage-backup-*-before-update*.zip' |
        Where-Object { $_.LastWriteTime -ge $Since } | Sort-Object LastWriteTime | Select-Object -Last 1
}

function Remove-OldVersions {
    <# Remove the version folders no longer needed: all but this one and `Previous`. #>
    param([string]$Previous, [hashtable]$Settings)
    $folders = @(Get-ChildItem -LiteralPath (Join-Path $InstallDir 'versions') -Directory | ForEach-Object { $_.FullName })
    $old = Select-OldVersions -Folders $folders -Current $AppDir -Previous $Previous `
        -Keeping @($Settings['DATA_DIR'], $Settings['BACKUP_DIR'])
    foreach ($folder in $old) {
        try {
            Remove-Item -LiteralPath $folder -Recurse -Force
        } catch {
            Write-Host "The old version in $folder could not be removed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

function Switch-ToThisVersion {
    <# Stop the version in `Current`, start this one, and point InstallDir\app at it once it
       answers. If anything fails on the way, stop this one and start `Current` again (if it
       was running), then stop, saying why. #>
    param([string]$Current, [string]$Mode)
    $settings = Read-EnvFile
    Assert-DataOutside $settings $Current
    $currentEnv = Read-EnvText ([IO.File]::ReadAllText((Join-Path $Current '.env')))
    $currentMode = Select-Mode -Requested $currentEnv['RUN_WITH'] -DockerInstalled (Test-Command docker)
    # The new version's containers replace the old one's, so those are not stopped first.
    $bothDocker = $currentMode -eq 'docker' -and $Mode -eq 'docker'
    $since = Get-Date
    $wasRunning = $false
    $switching = $false
    try {
        $wasRunning = Stop-RunningApp -Mode $currentMode -Folder $Current -Replaced:$bothDocker
        if (Test-Inside $Current (Join-Path $InstallDir 'app')) {
            # From before versions had folders: stopped first, so nothing holds its files.
            $Current = Move-ToVersionsLayout -InstallDir $InstallDir
        }
        Write-Host "Starting version $(Get-AppVersion)..."
        Start-Version $AppDir $Mode
        if (-not (Wait-Version (Get-AppPort $settings))) {
            throw "Version $(Get-AppVersion) did not start within $StartMinutes minutes."
        }
        $switching = $true
        Set-AppJunction -InstallDir $InstallDir -Target $AppDir
    } catch {
        $reason = $_.Exception.Message
        $backup = Find-UpdateBackup $settings['BACKUP_DIR'] $since
        try {
            Stop-RunningApp -Mode $Mode -Folder $AppDir -Replaced:$bothDocker | Out-Null
            if ($switching) { Set-AppJunction -InstallDir $InstallDir -Target $Current }
            if ($wasRunning) { Start-Version $Current $currentMode }
        } catch {
            $reason += " Starting the version before it again failed too: $($_.Exception.Message)"
        }
        if ($backup) {
            $reason += " It had already updated the database, so the version before it may not start on it; if it doesn't, restore $($backup.FullName) (see Backups in the README)."
        }
        throw $reason
    }
    Remove-OldVersions -Previous $Current -Settings $settings
}

function Install-App {
    $current = Get-CurrentVersion $InstallDir
    $chosen = Select-Mode -Requested $Mode -DockerInstalled (Test-Command docker)
    if ($chosen -eq 'docker') {
        Write-Host 'Docker is installed: the app will run in Docker.'
    } else {
        Write-Host 'Docker is not installed: the app will run directly on this PC.'
    }
    # An older Setup puts the new code into InstallDir\app itself, and runs this from there:
    # then it is installed in place, as before, and the next Setup (this version's) moves it.
    $inPlace = $current -and (Test-Inside $AppDir $current)
    if ($current -and -not $inPlace) { Copy-EnvForward $current }
    Initialize-EnvFile -Mode $chosen -InstallDir $InstallDir -NonInteractive:$NonInteractive
    if ($chosen -eq 'docker') { Install-Docker } else { Install-Local }
    if ($inPlace) {
        $current = $null  # set up as the first time
    } elseif ($current) {
        Switch-ToThisVersion $current $chosen
    } else {
        Set-AppJunction -InstallDir $InstallDir -Target $AppDir
    }
    New-DesktopShortcut
    Register-AppLink (Join-Path $InstallDir 'app')

    Write-Host ''
    if ($current) {
        Write-Host "Mortgage Management is updated to version $(Get-AppVersion), and running." -ForegroundColor Green
        if ($chosen -eq 'local') { Write-Host 'It runs in the window that opened: keep it open while you use it.' }
        if (-not $NonInteractive) { Start-Process "http://localhost:$(Get-AppPort (Read-EnvFile))" | Out-Null }
        return
    }
    Write-Host 'Mortgage Management is set up.' -ForegroundColor Green
    Write-Host 'Start it any time with the "Mortgage Management" shortcut on the Desktop,'
    Write-Host 'or from the installed app''s icon: when the app is not running it offers to start it.'
    Write-Host 'Run Setup again to update to the newest release.'
    if (-not $NonInteractive) {
        $start = Read-Host 'Start it now? [Y/n]'
        if ($start -eq '' -or $start -match '^[Yy]') { & (Join-Path $PSScriptRoot 'run.ps1') }
    }
}

# Dot-sourced (by the tests) it only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') { Install-App }
