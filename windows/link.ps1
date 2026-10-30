<#
Opens a mortgage-management:// link (Setup registers the link for the Windows user; see
Documentation/adr/0008):

  mortgage-management://start   The installed app's offline screen: starts the app the way
                                the Desktop shortcut does, without opening a browser tab:
                                the app loads itself once it answers.
  mortgage-management://update  The update banner's Install now: runs Setup for the newest
                                release, which switches to it once it starts; the app
                                reloads itself once the new version answers.

Any web page can open the link, so it does only what it names, and only for the exact
links above; anything else does nothing.

Windows PowerShell 5.1 compatible, and ASCII only.
#>
param(
    # What Windows passes: the link that was opened.
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
)

. (Join-Path $PSScriptRoot 'common.ps1')

function Select-LinkAction {
    <# What `Arguments` asks for: 'start' or 'update', or nothing for anything but those links. #>
    param([string[]]$Arguments)
    if (@($Arguments).Count -ne 1) { return $null }
    if ($Arguments[0] -match '^mortgage-management://(start|update)/?$') { return $Matches[1].ToLower() }
    return $null
}

function Start-Launcher { & (Join-Path $PSScriptRoot 'Run.bat') -NoBrowser }

function Start-Setup {
    <# Setup for the newest release, into this install; its window stays open if it fails. #>
    $global:LASTEXITCODE = 0  # set by Setup only if it fails
    & (Join-Path $PSScriptRoot 'setup.ps1') -NonInteractive -InstallDir (Get-InstallDir)
    if ($LASTEXITCODE -ne 0) { Read-Host 'Press Enter to close this window' | Out-Null }
}

function Open-Link {
    param([string[]]$Arguments)
    switch (Select-LinkAction $Arguments) {
        'start' { Start-Launcher }
        'update' { Start-Setup }
    }
}

# Dot-sourced (by the tests) it only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') { Open-Link $Arguments }
