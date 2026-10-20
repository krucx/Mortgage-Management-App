<#
Sets up Mortgage Management on this Windows PC, or updates it when run again: gets the
app's code (the latest release unless -Ref names another), then runs install.ps1 from
that code, which keeps the .env and data.

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

function Get-LatestRelease {
    $tags = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/$Repo/tags?per_page=100"
    $latest = Select-LatestVersion @($tags | ForEach-Object { $_.name })
    if (-not $latest) { throw "No release of $Repo was found." }
    return $latest
}

function Assert-Success {
    param([string]$What)
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

function Save-EnvAside {
    <# The app's .env, if there is one, moved out of the way; restored by Restore-Env. #>
    param([string]$AppDir)
    $envFile = Join-Path $AppDir '.env'
    if (-not (Test-Path $envFile)) { return $null }
    $aside = Join-Path ([IO.Path]::GetTempPath()) ('mortgage-env-' + [guid]::NewGuid())
    Copy-Item $envFile $aside
    return $aside
}

function Restore-Env {
    param([string]$Aside, [string]$AppDir)
    if ($Aside) { Move-Item -Force $Aside (Join-Path $AppDir '.env') }
}

function Get-AppCodeWithGit {
    param([string]$Ref, [string]$AppDir)
    if (-not (Test-Path (Join-Path $AppDir '.git'))) {
        $aside = Save-EnvAside $AppDir
        if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
        & git clone --quiet "https://github.com/$Repo.git" $AppDir
        Assert-Success 'Getting the code (git clone)'
        Restore-Env $aside $AppDir
    }
    & git -C $AppDir fetch --quiet --tags --force origin
    Assert-Success 'Getting the latest code (git fetch)'
    & git -C $AppDir rev-parse --verify --quiet "refs/remotes/origin/$Ref" *> $null
    if ($LASTEXITCODE -eq 0) {
        $target = "origin/$Ref"  # a branch
    } else {
        & git -C $AppDir fetch --quiet origin $Ref *> $null  # a commit not on a branch yet
        $target = $Ref
    }
    & git -C $AppDir checkout --quiet --force --detach $target
    Assert-Success "Switching to $Ref (git checkout)"
}

function Get-AppCodeDownload {
    <# Without git: the code as a zip from GitHub, replacing what was there but the .env. #>
    param([string]$Ref, [string]$AppDir)
    $work = Join-Path ([IO.Path]::GetTempPath()) ('mortgage-code-' + [guid]::NewGuid())
    New-Item -ItemType Directory $work | Out-Null
    try {
        $zip = Join-Path $work 'code.zip'
        Invoke-WebRequest -UseBasicParsing "https://codeload.github.com/$Repo/zip/$Ref" -OutFile $zip
        Expand-Archive $zip (Join-Path $work 'code')
        $unpacked = Get-ChildItem (Join-Path $work 'code') | Select-Object -First 1
        $aside = Save-EnvAside $AppDir
        if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
        Move-Item $unpacked.FullName $AppDir
        Restore-Env $aside $AppDir
    } finally {
        Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
    }
}

function Main {
    # GitHub needs TLS 1.2, which Windows PowerShell 5.1 does not always offer by default.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if (-not $InstallDir) { $InstallDir = Join-Path $env:USERPROFILE 'MortgageManagement' }
    $appDir = Join-Path $InstallDir 'app'
    New-Item -ItemType Directory -Force $InstallDir | Out-Null

    Write-Host ''
    Write-Host 'Mortgage Management setup' -ForegroundColor Yellow
    Write-Host "Installing in $InstallDir"
    if (-not $Ref) { $Ref = Get-LatestRelease }
    Write-Host "Getting version $Ref..."
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Get-AppCodeWithGit $Ref $appDir
    } else {
        Get-AppCodeDownload $Ref $appDir
    }

    $install = Join-Path $appDir 'windows\install.ps1'
    if (-not (Test-Path $install)) {
        throw "Version $Ref is too old for this setup (it has no windows\install.ps1)."
    }
    & $install -InstallDir $InstallDir -Mode $Mode -NonInteractive:$NonInteractive
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
