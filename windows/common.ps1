# Shared by install.ps1, run.ps1 and uninstall.ps1: the app's .env file, the shortcut and the
# mortgage-management:// link, the PATH, and waiting for things to start. Windows PowerShell 5.1 compatible, and ASCII only (5.1 misreads anything else).

$ErrorActionPreference = 'Stop'

# The folder that holds the app's code (this file is in its windows folder).
$AppDir = Split-Path -Parent $PSScriptRoot

function Get-InstallDir {
    <# The folder the app is installed in: the one holding app (the junction to the version
       that runs) and versions, whichever path this code was started by. #>
    $parent = Split-Path -Parent $AppDir
    if ((Split-Path -Leaf $parent) -eq 'versions') { return Split-Path -Parent $parent }
    return $parent
}

function Select-Mode {
    <# How the app runs: 'docker' when Docker is installed, else 'local' (uv and npm),
       unless one was asked for. #>
    param([string]$Requested, [bool]$DockerInstalled)
    if ($Requested -eq 'docker' -or $Requested -eq 'local') { return $Requested }
    if ($DockerInstalled) { return 'docker' }
    return 'local'
}

function Test-Inside {
    <# Whether `Path` is `Folder` or inside it. #>
    param([string]$Path, [string]$Folder)
    $separator = [IO.Path]::DirectorySeparatorChar
    $path = [IO.Path]::GetFullPath($Path).TrimEnd($separator) + $separator
    $folder = [IO.Path]::GetFullPath($Folder).TrimEnd($separator) + $separator
    return $path.StartsWith($folder, [StringComparison]::OrdinalIgnoreCase)
}

function Select-OldVersions {
    <# Which of the version folders `Folders` to remove after a switch: all but the one now
       running and the one before it (to go back to), and never one that holds a folder in
       `Keeping` (the data or Backup folder). #>
    param([string[]]$Folders, [string]$Current, [string]$Previous, [string[]]$Keeping = @())
    return @($Folders | Where-Object {
        $folder = $_
        -not (Test-Inside $folder $Current) -and -not ($Previous -and (Test-Inside $folder $Previous)) -and
            -not @($Keeping | Where-Object { $_ -and (Test-Inside $_ $folder) })
    })
}

function Select-AppProcessIds {
    <# The ids among `Processes` (Win32_Process) of the app run from `Folder`: those run from
       it, by program or command line, and everything they started. Never `Self` or the
       processes it runs under (Setup's or the uninstaller's own window can be in Folder too). #>
    param([object[]]$Processes, [string]$Folder, [int]$Self)
    $inside = $Folder.TrimEnd('\') + '\'
    $byId = @{}
    foreach ($process in $Processes) { $byId[[int]$process.ProcessId] = $process }
    $spared = @{}
    for ($id = $Self; $byId.ContainsKey($id) -and -not $spared.ContainsKey($id);
         $id = [int]$byId[$id].ParentProcessId) {
        $spared[$id] = $true
    }
    $stopping = @{}
    foreach ($process in $Processes) {
        $text = "$($process.ExecutablePath) $($process.CommandLine)"
        if (-not $spared.ContainsKey([int]$process.ProcessId) -and
                $text.IndexOf($inside, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $stopping[[int]$process.ProcessId] = $true
        }
    }
    do {
        # What a stopping process started, until there is nothing more.
        $added = $false
        foreach ($process in $Processes) {
            $id = [int]$process.ProcessId
            if (-not $stopping.ContainsKey($id) -and -not $spared.ContainsKey($id) -and
                    $stopping.ContainsKey([int]$process.ParentProcessId)) {
                $stopping[$id] = $true
                $added = $true
            }
        }
    } while ($added)
    return @($stopping.Keys)
}

function Select-FreeFolder {
    <# Parent\Name, or Name-2, Name-3 and on when that is taken. #>
    param([string]$Parent, [string]$Name)
    $folder = Join-Path $Parent $Name
    for ($n = 2; Test-Path -LiteralPath $folder; $n++) { $folder = Join-Path $Parent "$Name-$n" }
    return $folder
}

function Test-Junction {
    <# Whether `Path` is a junction (or other link), not a folder of its own. #>
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    return [bool]($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint))
}

function Set-AppJunction {
    <# Point InstallDir\app (a junction, so the shortcut, the link and app\.env keep their
       paths) at the version folder `Target`. Removing a junction leaves what it points at. #>
    param([string]$InstallDir, [string]$Target)
    $app = Join-Path $InstallDir 'app'
    if (Test-Junction $app) {
        [IO.Directory]::Delete($app)
    } elseif (Test-Path -LiteralPath $app) {
        throw "$app is a folder, not a link to a version."
    }
    New-Item -ItemType Junction -Path $app -Target $Target | Out-Null
}

function Get-CurrentVersion {
    <# The folder of the version InstallDir\app runs: what its junction points at, the app
       folder itself for an install from before versions had folders, or nothing. #>
    param([string]$InstallDir)
    $app = Join-Path $InstallDir 'app'
    if (Test-Junction $app) { return @((Get-Item -LiteralPath $app -Force).Target)[0] }
    if (Test-Path -LiteralPath (Join-Path $app '.env')) { return $app }
    return $null
}

function Assert-DataOutside {
    <# Stop if the data or Backup folder in `Settings` (.env) is inside `Folder` (or relative,
       so inside whichever version runs): switching versions would leave it behind. #>
    param([hashtable]$Settings, [string]$Folder)
    foreach ($name in 'DATA_DIR', 'BACKUP_DIR') {
        $value = $Settings[$name]
        if ($value -and (-not [IO.Path]::IsPathRooted($value) -or (Test-Inside $value $Folder))) {
            throw "The $name folder $value is inside the app folder, where an update would leave it behind. Move it out (see the README), set $name in app\.env, then run Setup again."
        }
    }
}

function Move-ToVersionsLayout {
    <# Turn an install from before versions had folders (the code in InstallDir\app) into the
       folder of its version, InstallDir\versions\<version>, with app pointing at it. The data
       and Backup folders stay where they are. The folder it became. #>
    param([string]$InstallDir)
    $app = Join-Path $InstallDir 'app'
    Assert-DataOutside (Read-EnvText ([IO.File]::ReadAllText((Join-Path $app '.env')))) $app
    $version = Get-AppVersion $app
    $versions = Join-Path $InstallDir 'versions'
    New-Item -ItemType Directory -Force $versions | Out-Null
    $folder = Select-FreeFolder $versions $(if ($version) { $version } else { 'previous' })
    Move-Item -LiteralPath $app $folder
    Set-AppJunction -InstallDir $InstallDir -Target $folder
    return $folder
}

function Get-AppVersion {
    <# The version of the app whose code is in `Folder` (its package.json), or nothing. #>
    param([string]$Folder = $AppDir)
    $package = Join-Path $Folder 'frontend\package.json'
    if (-not (Test-Path $package)) { return $null }
    return (Get-Content -Raw $package | ConvertFrom-Json).version
}

function Select-ImageVersion {
    <# The Docker images a version runs: the release the .env asks for (APP_VERSION), else
       its own, so going back to an older version runs that version's images again. #>
    param([string]$Requested, [string]$Version)
    if ($Requested) { return $Requested }
    if ($Version) { return $Version }
    return 'latest'
}

function Use-ComposeVersion {
    <# Docker Compose, for the code in `Folder`: always the one project 'app' (the name the
       app folder gave it before versions had folders of their own), with that version's images. #>
    param([string]$Folder = $AppDir)
    $env:COMPOSE_PROJECT_NAME = 'app'
    $envFile = Join-Path $Folder '.env'
    $requested = if (Test-Path $envFile) { (Read-EnvText ([IO.File]::ReadAllText($envFile)))['APP_VERSION'] } else { '' }
    $env:APP_VERSION = Select-ImageVersion -Requested $requested -Version (Get-AppVersion $Folder)
}

function Invoke-AppCompose {
    <# docker compose `Arguments`, for the code in `Folder` (Use-ComposeVersion); stops, saying
       `What` failed, if it does. #>
    param([string]$Folder, [string]$What, [string[]]$Arguments)
    Use-ComposeVersion $Folder
    Push-Location $Folder
    try {
        & docker compose @Arguments
        Assert-Success $What
    } finally { Pop-Location }
}

function Get-AppPort {
    <# The port the app is opened on, from the .env `Settings`. #>
    param([hashtable]$Settings)
    if ($Settings['APP_PORT']) { return $Settings['APP_PORT'] }
    return '8080'
}

function Test-PasswordWritable {
    <# Whether a Backup password can go in .env as written: single-quoted, so spaces and
       # are kept, which leaves no way to write a single quote. #>
    param([string]$Password)
    return -not $Password.Contains("'")
}

function New-EnvText {
    <# A new .env for the app. Docker Compose reads it, and so does run.ps1. #>
    param([string]$Mode, [string]$DataDir, [string]$BackupDir, [string]$Password)
    $lines = @(
        '# Written by the Windows setup. Paths are folders on this computer.',
        '',
        '# How the app runs: docker (the published images) or local (uv and npm).',
        "RUN_WITH=$Mode",
        '',
        '# Database and photos live here. Back this folder up!',
        "DATA_DIR=$DataDir",
        '',
        '# Backups are written here; it can be a Google Drive / OneDrive synced folder.',
        "BACKUP_DIR=$BackupDir",
        '',
        '# Password for the Backup zips (with Docker only). Keep it somewhere safe.',
        "BACKUP_PASSWORD='$Password'",
        '',
        '# Time zone for every business date, with Docker (without it, the PC''s own).',
        'TZ=Asia/Kolkata',
        '',
        '# Open the app at http://localhost:<APP_PORT>',
        'APP_PORT=8080',
        '',
        '# Which release to run with Docker, e.g. 1.2.0. Empty for the latest.',
        'APP_VERSION='
    )
    return ($lines -join "`r`n") + "`r`n"
}

function Read-EnvText {
    <# The values in .env text, by name: comments and blank lines skipped, one pair of
       surrounding quotes removed. #>
    param([string]$Text)
    $values = @{}
    foreach ($line in ($Text -split "`r?`n")) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
        $equals = $trimmed.IndexOf('=')
        if ($equals -lt 1) { continue }
        $name = $trimmed.Substring(0, $equals).Trim()
        $value = $trimmed.Substring($equals + 1).Trim()
        if ($value.Length -ge 2 -and (
                ($value.StartsWith("'") -and $value.EndsWith("'")) -or
                ($value.StartsWith('"') -and $value.EndsWith('"')))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$name] = $value
    }
    return $values
}

function Set-EnvValue {
    <# The .env text with one value set: changed where it is, or added at the end. #>
    param([string]$Text, [string]$Name, [string]$Value)
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=[^\r\n]*'  # the line's own end kept
    if ([regex]::IsMatch($Text, $pattern)) {
        return [regex]::Replace($Text, $pattern, ($Name + '=' + $Value).Replace('$', '$$'))
    }
    if ($Text -ne '' -and -not $Text.EndsWith("`n")) { $Text += "`r`n" }
    return $Text + "$Name=$Value`r`n"
}

function Get-EnvPath { return Join-Path $AppDir '.env' }

function Get-ShortcutPath {
    return Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mortgage Management.lnk'
}

function Set-UserClassValue {
    <# Set a value under the Windows user's HKCU\Software\Classes\`Key` ('' names the default). #>
    param([string]$Key, [string]$Name, [string]$Value)
    $opened = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$Key")
    try { $opened.SetValue($Name, $Value) } finally { $opened.Close() }
}

function Remove-UserClassKey {
    <# Remove HKCU\Software\Classes\`Key` and everything under it, if it is there. #>
    param([string]$Key)
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("Software\Classes\$Key", $false)
}

function Register-AppLink {
    <# The mortgage-management:// link, for this Windows user, opened by link.ps1 in `Folder`
       (which starts the app); the installed app's offline screen opens it (Documentation/adr/0008). #>
    param([string]$Folder = $AppDir)
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $handler = Join-Path $Folder 'windows\link.ps1'
    Set-UserClassValue 'mortgage-management' '' 'URL:Mortgage Management'
    Set-UserClassValue 'mortgage-management' 'URL Protocol' ''
    Set-UserClassValue 'mortgage-management\DefaultIcon' '' (Join-Path $Folder 'windows\MortgageManagement.ico')
    Set-UserClassValue 'mortgage-management\shell\open\command' '' `
        "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$handler`" `"%1`""
}

function Unregister-AppLink { Remove-UserClassKey 'mortgage-management' }

function Read-EnvFile { return Read-EnvText ([IO.File]::ReadAllText((Get-EnvPath))) }

function Write-EnvFile {
    param([string]$Text)
    # UTF-8 without a byte-order mark, which Docker Compose would read as part of a name.
    [IO.File]::WriteAllText((Get-EnvPath), $Text, (New-Object Text.UTF8Encoding $false))
}

function Update-SessionPath {
    <# Pick up programs installed since this window opened (winget, uv's installer). #>
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $uvBin = Join-Path $env:USERPROFILE '.local\bin'
    $env:Path = (@($machine, $user, $uvBin) | Where-Object { $_ }) -join ';'
}

function Assert-Success {
    <# Stop if the program just run failed. #>
    param([string]$What)
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Wait-Url {
    <# Whether `Url` answers within `Seconds`. #>
    param([string]$Url, [int]$Seconds = 120)
    $until = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $until) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5 | Out-Null
            return $true
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

function Test-DockerRunning {
    & docker info *> $null
    return $LASTEXITCODE -eq 0
}

function Start-DockerDesktop {
    <# Make sure Docker is running, starting Docker Desktop and waiting for it if not. #>
    if (Test-DockerRunning) { return }
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path $desktop)) {
        throw 'Docker is installed but not running. Start Docker Desktop, then try again.'
    }
    Write-Host 'Starting Docker Desktop (this can take a minute or two)...'
    Start-Process $desktop | Out-Null
    $until = (Get-Date).AddMinutes(4)
    while ((Get-Date) -lt $until) {
        Start-Sleep -Seconds 5
        if (Test-DockerRunning) { return }
    }
    throw 'Docker Desktop did not start. Open it, wait until it says it is running, then try again.'
}
