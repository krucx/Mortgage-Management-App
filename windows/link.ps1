<#
Opens a mortgage-management:// link (Setup registers the link for the Windows user; see
Documentation/adr/0008). The installed app's offline screen opens mortgage-management://start
to start the app the way the Desktop shortcut does, without opening a browser tab: the app
loads itself once it answers.

Any web page can open the link, so it does only what it names, and only for the exact
links below; anything else does nothing.

Windows PowerShell 5.1 compatible, and ASCII only.
#>
param(
    # What Windows passes: the link that was opened.
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
)

$ErrorActionPreference = 'Stop'

function Select-LinkAction {
    <# What `Arguments` asks for: 'start', or nothing for anything but that one link. #>
    param([string[]]$Arguments)
    if (@($Arguments).Count -ne 1) { return $null }
    if ($Arguments[0] -match '^mortgage-management://(start)/?$') { return $Matches[1].ToLower() }
    return $null
}

# Dot-sourced (by the tests) it only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') {
    if ((Select-LinkAction $Arguments) -eq 'start') {
        & (Join-Path $PSScriptRoot 'Run.bat') -NoBrowser
    }
}
