<#
Removes Mortgage Management from this Windows PC (run by Uninstall.bat). It stops the app
and moves the latest Backup into Documents, so the data can be brought back; only then
does it remove the Docker images, the Desktop shortcut and mortgage-management:// link, the
data folder and the install folder.

A Backup folder outside the install folder (a Google Drive or OneDrive folder chosen at
setup) is left as it is, the latest Backup copied rather than moved from it: changing it
would change the copies kept off this PC too. Node.js
and uv, if setup installed them, stay installed, as other programs may use them.

Windows PowerShell 5.1 compatible, and ASCII only.
#>
param(
    # Where the latest Backup is kept: Documents by default.
    [string]$KeepBackupIn = '',
    # Remove without asking (for CI); stops, removing nothing, if there is no Backup.
    [switch]$NonInteractive
)

. (Join-Path $PSScriptRoot 'common.ps1')

function Select-LatestBackup {
    <# The most recently written Backup zip in `Folder`, or nothing. Half-written ones have
       a .partial name, so they are never picked. #>
    param([string]$Folder)
    if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { return $null }
    return Get-ChildItem -LiteralPath $Folder -File -Force |
        Where-Object { $_.Name -match '^mortgage-backup-.*\.zip$' } |
        Sort-Object LastWriteTime | Select-Object -Last 1
}

function Save-BackupTo {
    <# Move `Backup` into `Folder` (or copy it, to leave the original), numbered
       "name (2).zip" and on if its name is taken there, so nothing already in `Folder` is
       overwritten. The path it was saved to. #>
    param([IO.FileInfo]$Backup, [string]$Folder, [switch]$LeaveOriginal)
    $target = Join-Path $Folder $Backup.Name
    $n = 1
    while (Test-Path -LiteralPath $target) {
        $n++
        $target = Join-Path $Folder ('{0} ({1}){2}' -f $Backup.BaseName, $n, $Backup.Extension)
    }
    if ($LeaveOriginal) {
        Copy-Item -LiteralPath $Backup.FullName $target
    } else {
        Move-Item -LiteralPath $Backup.FullName $target
    }
    return $target
}

function Confirm-Yes {
    <# Whether the person typed yes to `Question`. #>
    param([string]$Question)
    return (Read-Host "$Question Type yes to go ahead") -eq 'yes'
}

function Stop-App {
    <# Stop the app, so no Backup is written while it is removed, and its files can go. #>
    param([hashtable]$Settings, [string]$InstallDir)
    if ($Settings['RUN_WITH'] -eq 'docker') {
        # Left running, Docker would start it again (with empty folders) after it is removed.
        if (-not (Test-Command docker)) {
            throw 'The app runs in Docker, but Docker is not installed any more, so it cannot be stopped.'
        }
        Start-DockerDesktop
        Write-Host 'Stopping the app...'
        Invoke-AppCompose $AppDir 'Stopping the app (docker compose down)' @('down')
    }
    # Without Docker the app runs from Run.bat's window, of whichever version.
    $ids = Select-AppProcessIds -Processes @(Get-CimInstance Win32_Process) -Folder $InstallDir -Self $PID
    if ($ids.Count -gt 0) {
        Write-Host 'Stopping the app...'
        foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2  # Windows lets go of their files a moment later
    }
}

function Remove-Folder {
    <# Delete `Folder`, trying again for a little while if Windows still holds a file in it. #>
    param([string]$Folder)
    for ($try = 1; Test-Path -LiteralPath $Folder; $try++) {
        try {
            Remove-Item -LiteralPath $Folder -Recurse -Force
        } catch {
            if ($try -ge 5) {
                throw "$Folder could not be deleted ($($_.Exception.Message)). Close any window or program using it, then delete it by hand."
            }
            Start-Sleep -Seconds 2
        }
    }
}

function Get-AppFolder {
    <# A folder from .env, or `Default`. A relative one is relative to the app folder, as
       it is for Docker Compose. #>
    param([string]$Value, [string]$Default)
    if (-not $Value) { return $Default }
    if ([IO.Path]::IsPathRooted($Value)) { return $Value }
    return [IO.Path]::GetFullPath((Join-Path $AppDir $Value))
}

function Assert-Deletable {
    <# Stop, before anything is changed, if deleting `Folder` would delete more than the
       app: a whole drive, the user's own folder, or anything in `Keeping`. #>
    param([string]$Folder, [string[]]$Keeping)
    $full = [IO.Path]::GetFullPath($Folder).TrimEnd('\')
    $kept = @($Keeping | Where-Object { Test-Inside $_ $Folder })
    if (-not (Split-Path -Parent $full) -or (Test-Inside $env:USERPROFILE $Folder) -or $kept) {
        throw "$Folder holds more than Mortgage Management, so nothing was removed. Delete what is the app's in it by hand."
    }
}

function Main {
    # Out of the app folder, so this window does not keep it from being deleted.
    Set-Location ([IO.Path]::GetTempPath())
    $installDir = Get-InstallDir
    $settings = if (Test-Path (Get-EnvPath)) { Read-EnvFile } else { @{} }
    $dataDir = Get-AppFolder $settings['DATA_DIR'] (Join-Path $installDir 'data')
    $backupDir = Get-AppFolder $settings['BACKUP_DIR'] (Join-Path $installDir 'backups')
    $keepIn = if ($KeepBackupIn) { $KeepBackupIn } else { [Environment]::GetFolderPath('MyDocuments') }
    $backupDirStays = -not (Test-Inside $backupDir $installDir)
    $keeping = @($keepIn) + @(if ($backupDirStays) { $backupDir })
    Assert-Deletable $installDir $keeping
    Assert-Deletable $dataDir $keeping

    Write-Host ''
    Write-Host 'Remove Mortgage Management from this PC' -ForegroundColor Yellow
    Write-Host "It stops the app and keeps its latest Backup in $keepIn. Then these are deleted:"
    Write-Host "  $installDir (the app)"
    if (-not (Test-Inside $dataDir $installDir)) { Write-Host "  $dataDir (its data)" }
    Write-Host '  the Mortgage Management shortcut on the Desktop, and its mortgage-management:// link'
    if ($settings['RUN_WITH'] -eq 'docker') { Write-Host '  its Docker images' }
    if ($backupDirStays) { Write-Host "The Backup folder $backupDir is left as it is." }
    $question = 'Remove Mortgage Management?'
    if (-not (Select-LatestBackup $backupDir)) {
        Write-Host "There is no Backup in $backupDir to keep: all its data will be lost." -ForegroundColor Yellow
        if ($NonInteractive) { throw 'There is no Backup to keep, so nothing was removed.' }
        $question = 'Remove it anyway, with no Backup?'
    }
    if (-not $NonInteractive -and -not (Confirm-Yes $question)) {
        Write-Host 'Nothing was removed.'
        return
    }

    Stop-App $settings $installDir
    # Picked once the app is stopped, so no newer Backup can follow it.
    $latest = Select-LatestBackup $backupDir
    if ($latest) {
        New-Item -ItemType Directory -Force $keepIn | Out-Null
        $kept = Save-BackupTo $latest $keepIn -LeaveOriginal:$backupDirStays
        Write-Host "The latest Backup is kept: $kept" -ForegroundColor Green
        Write-Host 'If Backups had a password, it opens with that password.'
    }

    if ($settings['RUN_WITH'] -eq 'docker') {
        Write-Host 'Removing its Docker images...'
        Invoke-AppCompose $AppDir 'Removing the Docker images (docker compose down --rmi all)' @('down', '--rmi', 'all')
    }
    $shortcut = Get-ShortcutPath
    if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut -Force }
    Unregister-AppLink
    Write-Host 'Deleting the app and its data...'
    # The junction to the version that runs first, by itself, so nothing is deleted through it.
    $app = Join-Path $installDir 'app'
    if (Test-Junction $app) { [IO.Directory]::Delete($app) }
    Remove-Folder $dataDir
    Remove-Folder $installDir

    Write-Host ''
    Write-Host 'Mortgage Management is removed from this PC.' -ForegroundColor Green
    if ($latest) { Write-Host "Its latest Backup is in $keepIn." }
    if ($backupDirStays) { Write-Host "Its Backups are still in $backupDir too." }
}

# Dot-sourced (by the tests) it only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        Main
    } catch {
        Write-Host ''
        Write-Host "Removing stopped: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}
