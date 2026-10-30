# Shared by install.ps1, run.ps1 and uninstall.ps1: the app's .env file, the shortcut and the
# mortgage-management:// link, the PATH, and waiting for things to start. Windows PowerShell 5.1 compatible, and ASCII only (5.1 misreads anything else).

$ErrorActionPreference = 'Stop'

# The folder that holds the app's code (this file is in its windows folder).
$AppDir = Split-Path -Parent $PSScriptRoot

function Select-Mode {
    <# How the app runs: 'docker' when Docker is installed, else 'local' (uv and npm),
       unless one was asked for. #>
    param([string]$Requested, [bool]$DockerInstalled)
    if ($Requested -eq 'docker' -or $Requested -eq 'local') { return $Requested }
    if ($DockerInstalled) { return 'docker' }
    return 'local'
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
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=.*$'
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
    <# The mortgage-management:// link, for this Windows user, opened by link.ps1 (which
       starts the app); the installed app's offline screen opens it (Documentation/adr/0008). #>
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $handler = Join-Path $AppDir 'windows\link.ps1'
    Set-UserClassValue 'mortgage-management' '' 'URL:Mortgage Management'
    Set-UserClassValue 'mortgage-management' 'URL Protocol' ''
    Set-UserClassValue 'mortgage-management\DefaultIcon' '' (Join-Path $AppDir 'windows\MortgageManagement.ico')
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
