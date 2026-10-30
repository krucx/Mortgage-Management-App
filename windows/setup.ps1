<#
Sets up Mortgage Management on this Windows PC, or updates it when run again: gets the
app's code (the latest release unless -Ref names another) into a folder of its own,
InstallDir\versions\<version>, beside the version installed, then runs install.ps1 from
that code, which switches to it only once it starts. If anything fails, the version
installed stays, and the new folder goes.

It may be downloaded on its own (by Setup.bat), so it uses nothing else from the repo
until the code is here. Windows PowerShell 5.1 compatible, and ASCII only.
#>
param(
    # A release (e.g. 1.3.0), branch or commit to set up; the latest release by default.
    [string]$Ref = '',
    # docker or local; auto uses Docker when it is installed.
    [ValidateSet('auto', 'docker', 'local')]
    [string]$Mode = 'auto',
    # Where the app, its data and Backups go: %USERPROFILE%\MortgageManagement by default.
    [string]$InstallDir = '',
    # Use the defaults instead of asking (for CI).
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$Repo = 'krucx/Mortgage-Management-App'

function Select-LatestVersion {
    <# The highest version among `Tags` (e.g. 1.10.0 over 1.2.0), or nothing. #>
    param([string[]]$Tags)
    $versions = @($Tags | Where-Object { $_ -match '^\d+\.\d+\.\d+$' })
    if ($versions.Count -eq 0) { return $null }
    return ($versions | Sort-Object { [version]$_ } | Select-Object -Last 1)
}

function Get-ReleaseTags {
    <# The repo's tags from GitHub; throws when GitHub can't be reached in a few seconds. #>
    return Invoke-RestMethod -UseBasicParsing -TimeoutSec 5 "https://api.github.com/repos/$Repo/tags?per_page=100"
}

function Get-LatestRelease {
    param([object[]]$Tags)
    $latest = Select-LatestVersion @($Tags | ForEach-Object { $_.name })
    if (-not $latest) { throw "No release of $Repo was found." }
    return $latest
}

function Get-InstalledVersion {
    <# The version of the app installed in `AppDir`, or nothing when there is none. #>
    param([string]$AppDir)
    if (-not (Test-Path (Join-Path $AppDir '.env'))) { return $null }
    $package = Join-Path $AppDir 'frontend\package.json'
    if (-not (Test-Path $package)) { return 'unknown' }
    return (Get-Content -Raw $package | ConvertFrom-Json).version
}

function Start-InstalledApp {
    <# Start the installed app the way the Desktop shortcut does. #>
    param([string]$AppDir)
    & (Join-Path $AppDir 'windows\run.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Mortgage Management could not start (see above).' }
}

function Assert-Success {
    param([string]$What)
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

function Select-FreeFolder {
    <# Parent\Name, or Name-2, Name-3 and on when that is taken (as in common.ps1, which is
       not here yet). #>
    param([string]$Parent, [string]$Name)
    $folder = Join-Path $Parent $Name
    for ($n = 2; Test-Path -LiteralPath $folder; $n++) { $folder = Join-Path $Parent "$Name-$n" }
    return $folder
}

function Get-AppCodeWithGit {
    <# Just `Ref` (a release, branch or commit), into the new folder `Folder`. #>
    param([string]$Ref, [string]$Folder)
    & git init --quiet $Folder
    Assert-Success 'Getting the code (git init)'
    & git -C $Folder fetch --quiet --depth 1 "https://github.com/$Repo.git" $Ref
    Assert-Success "Getting version $Ref (git fetch)"
    & git -C $Folder checkout --quiet --detach FETCH_HEAD
    Assert-Success "Switching to $Ref (git checkout)"
}

function Save-CodeZip {
    <# The zip at `Url` (one folder at its top), unpacked into the new folder `Folder`. #>
    param([string]$Url, [string]$Folder)
    $work = Join-Path ([IO.Path]::GetTempPath()) ('mortgage-code-' + [guid]::NewGuid())
    New-Item -ItemType Directory $work | Out-Null
    try {
        $zip = Join-Path $work 'code.zip'
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $zip
        Expand-Archive $zip (Join-Path $work 'code')
        $unpacked = Get-ChildItem (Join-Path $work 'code') | Select-Object -First 1
        Move-Item $unpacked.FullName $Folder
    } finally {
        Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
    }
}

function Get-AppCodeDownload {
    <# Without git: the code as a zip from GitHub, unpacked into the new folder `Folder`. #>
    param([string]$Ref, [string]$Folder)
    Save-CodeZip "https://codeload.github.com/$Repo/zip/$Ref" $Folder
}

function Get-ReadyBuilt {
    <# A release's ready-built download (the code with its screens built, published by the
       release workflow) into the new folder `Folder`. Whether there was one: a release
       from before it was published has none. #>
    param([string]$Version, [string]$Folder)
    try {
        Save-CodeZip "https://github.com/$Repo/releases/download/$Version/mortgage-management-$Version.zip" $Folder
        return $true
    } catch {
        $response = $_.Exception.Response
        if ($response -and [int]$response.StatusCode -eq 404) { return $false }
        throw
    }
}

function Get-AppCode {
    <# `Ref`'s code into the new folder `Folder`: a release's ready-built download, so nothing
       needs building on this PC; else the code itself, with git when it is installed. #>
    param([string]$Ref, [string]$Folder)
    if ($Ref -match '^\d+\.\d+\.\d+$' -and (Get-ReadyBuilt $Ref $Folder)) { return }
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Get-AppCodeWithGit $Ref $Folder
    } else {
        Get-AppCodeDownload $Ref $Folder
    }
}

function Get-JunctionTarget {
    <# What InstallDir\app points at, when it is a junction (install.ps1 makes it one). #>
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if (-not $item -or -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $null }
    return @($item.Target)[0]
}

function Test-HasNewest {
    <# Whether the version installed in `AppDir` needs nothing from the release `Latest`: it
       is newer (Setup never goes back), or it is that release itself, not code from a branch
       or commit of the same version (its folder is named after what was set up). #>
    param([string]$AppDir, [string]$Installed, [string]$Latest)
    if ($Installed -notmatch '^\d+\.\d+\.\d+$') { return $false }
    if ([version]$Installed -gt [version]$Latest) { return $true }
    if ($Installed -ne $Latest) { return $false }
    $target = Get-JunctionTarget $AppDir
    return -not $target -or ((Split-Path -Leaf $target) -replace '-\d+$', '') -eq $Installed
}

function Main {
    # GitHub needs TLS 1.2, which Windows PowerShell 5.1 does not always offer by default.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if (-not $InstallDir) { $InstallDir = Join-Path $env:USERPROFILE 'MortgageManagement' }
    # In full, so it reads the same as what InstallDir\app points at.
    $InstallDir = [IO.Path]::GetFullPath($InstallDir)
    $appDir = Join-Path $InstallDir 'app'
    New-Item -ItemType Directory -Force $InstallDir | Out-Null

    Write-Host ''
    Write-Host 'Mortgage Management setup' -ForegroundColor Yellow
    Write-Host "Installing in $InstallDir"
    $installed = Get-InstalledVersion $appDir
    try {
        $tags = Get-ReleaseTags
    } catch {
        # GitHub answered, but with an error (e.g. too many requests): not offline, and only
        # in the way when the latest release is to be found.
        if ($_.Exception.Response) {
            if (-not $Ref) { throw }
        } else {
            if (-not $installed) {
                throw 'GitHub cannot be reached, and the first setup needs internet: connect, then run Setup again.'
            }
            Write-Host "Offline: starting the version you have ($installed)" -ForegroundColor Yellow
            Start-InstalledApp $appDir
            return
        }
    }
    if (-not $Ref) {
        $latest = Get-LatestRelease $tags
        if ($installed -and (Test-HasNewest $appDir $installed $latest)) {
            Write-Host "Version $installed is installed, and no release is newer: starting it." -ForegroundColor Green
            Start-InstalledApp $appDir
            return
        }
        $Ref = $latest
    }
    Write-Host "Getting version $Ref..."
    $versions = Join-Path $InstallDir 'versions'
    New-Item -ItemType Directory -Force $versions | Out-Null
    # A branch name can hold characters a folder name can't.
    $folder = Select-FreeFolder $versions ($Ref -replace '[^A-Za-z0-9._-]', '-')
    try {
        Get-AppCode $Ref $folder
        $install = Join-Path $folder 'windows\install.ps1'
        if (-not (Test-Path $install)) {
            throw "Version $Ref is too old for this setup (it has no windows\install.ps1)."
        }
        & $install -InstallDir $InstallDir -Mode $Mode -NonInteractive:$NonInteractive
    } catch {
        $failure = $_.Exception.Message
        # install.ps1 had switched to it already: it is the version that runs.
        $target = Get-JunctionTarget $appDir
        if ($target -and [IO.Path]::GetFullPath($target).TrimEnd('\') -eq $folder.TrimEnd('\')) { throw }
        try {
            Remove-Item -LiteralPath $folder -Recurse -Force
        } catch {
            Write-Host "The unfinished version in $folder could not be removed: the next update removes it." -ForegroundColor Yellow
        }
        if ($installed) { throw "Update failed; still on $installed. $failure" }
        throw
    }
}

# Dot-sourced (by the tests) it only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        Main
    } catch {
        Write-Host ''
        Write-Host "Setup stopped: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}
