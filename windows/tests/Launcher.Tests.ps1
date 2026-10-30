# The Windows setup and run scripts' own decisions, without installing or starting anything.
# Run with Pester 5: Invoke-Pester windows/tests

BeforeAll {
    $windows = Split-Path -Parent $PSScriptRoot
    . (Join-Path $windows 'common.ps1')
    . (Join-Path $windows 'setup.ps1')   # dot-sourced: defines its functions, runs nothing
    . (Join-Path $windows 'install.ps1') -InstallDir $windows -Mode local -NonInteractive
    . (Join-Path $windows 'link.ps1')
}

Describe 'the latest release' {
    It 'is the highest version tag, compared as numbers' {
        Select-LatestVersion @('1.1.2', '1.10.0', '1.2.0') | Should -Be '1.10.0'
    }

    It 'ignores tags that are not versions' {
        Select-LatestVersion @('nightly', 'v2.0.0', '1.2.0', '1.2') | Should -Be '1.2.0'
    }

    It 'is nothing when there is no release yet' {
        Select-LatestVersion @('nightly') | Should -BeNullOrEmpty
    }
}

Describe 'Docker or local' {
    It 'uses Docker when it is installed' {
        Select-Mode -Requested 'auto' -DockerInstalled $true | Should -Be 'docker'
    }

    It 'runs locally when Docker is not installed' {
        Select-Mode -Requested 'auto' -DockerInstalled $false | Should -Be 'local'
    }

    It 'does what was asked for, whatever is installed' {
        Select-Mode -Requested 'local' -DockerInstalled $true | Should -Be 'local'
    }
}

Describe 'the .env file' {
    It 'holds the folders, the port and how the app runs' {
        $text = New-EnvText -Mode 'local' -DataDir 'C:\Users\Asha Rao\MortgageManagement\data' `
            -BackupDir 'C:\Users\Asha Rao\MortgageManagement\backups' -Password ''
        $values = Read-EnvText $text

        $values['RUN_WITH'] | Should -Be 'local'
        $values['DATA_DIR'] | Should -Be 'C:\Users\Asha Rao\MortgageManagement\data'
        $values['BACKUP_DIR'] | Should -Be 'C:\Users\Asha Rao\MortgageManagement\backups'
        $values['BACKUP_PASSWORD'] | Should -Be ''
        $values['APP_PORT'] | Should -Be '8080'
    }

    It 'persists a custom data folder for every app run' {
        $text = New-EnvText -Mode 'docker' -DataDir 'D:\Mortgage Data' `
            -BackupDir 'D:\Mortgage Backups' -Password ''

        (Read-EnvText $text)['DATA_DIR'] | Should -Be 'D:\Mortgage Data'
    }

    It 'keeps a Backup password exactly, spaces and # included' {
        $text = New-EnvText -Mode 'docker' -DataDir 'D' -BackupDir 'B' -Password 'open sesame #42'

        (Read-EnvText $text)['BACKUP_PASSWORD'] | Should -Be 'open sesame #42'
    }

    It 'refuses a Backup password it could not write safely' {
        Test-PasswordWritable "it's" | Should -BeFalse
        Test-PasswordWritable 'open sesame #42' | Should -BeTrue
    }

    It 'changes one value and leaves the rest, comments included' {
        $text = "# my notes`nDATA_DIR=D:\data`nRUN_WITH=local`n"

        $changed = Set-EnvValue $text 'RUN_WITH' 'docker'

        $changed | Should -Match '# my notes'
        (Read-EnvText $changed)['RUN_WITH'] | Should -Be 'docker'
        (Read-EnvText $changed)['DATA_DIR'] | Should -Be 'D:\data'
    }

    It 'adds a value that is missing' {
        (Read-EnvText (Set-EnvValue "DATA_DIR=D:\data`n" 'RUN_WITH' 'local'))['RUN_WITH'] |
            Should -Be 'local'
    }
}

Describe 'first setup folder selection' {
    It 'asks for and persists a custom data folder' {
        $InstallDir = Join-Path $TestDrive 'install'
        $NonInteractive = $false
        $chosenDataPath = Join-Path $TestDrive 'chosen data'
        $chosenBackupPath = Join-Path $TestDrive 'chosen backups'
        New-Item -ItemType Directory -Force $InstallDir | Out-Null

        Mock Get-EnvPath { Join-Path $InstallDir '.env' }
        Mock Read-Host {
            param([string]$Prompt)
            switch -Wildcard ($Prompt) {
                'Data folder*' { return $chosenDataPath }
                'Backup folder*' { return $chosenBackupPath }
                default { throw "Unexpected prompt: $Prompt" }
            }
        }

        Initialize-EnvFile -Mode 'local' -InstallDir $InstallDir -NonInteractive:$NonInteractive

        $values = Read-EnvText ([IO.File]::ReadAllText((Get-EnvPath)))
        $values['DATA_DIR'] | Should -Be $chosenDataPath
        Test-Path $chosenDataPath | Should -BeTrue
    }
}

# What Invoke-RestMethod throws when GitHub answers, but not with what was asked: it carries
# the response, which an unreachable GitHub never gives.
class GitHubAnswered : Exception {
    [object]$Response = 'HTTP 403'
    GitHubAnswered() : base('Response status code does not indicate success: 403 (rate limit exceeded).') {}
}

Describe 'Setup without internet' {
    BeforeEach {
        $InstallDir = Join-Path $TestDrive ([guid]::NewGuid())  # TestDrive lasts the whole Describe
        $Ref = ''
        $app = Join-Path $InstallDir 'app'
        Mock Invoke-RestMethod { throw [Net.WebException]::new('The remote name could not be resolved') }
        Mock Write-Host {}
        Mock Start-InstalledApp {}
    }

    It 'starts the version that is installed, saying so' {
        New-Item -ItemType Directory -Force (Join-Path $app 'frontend') | Out-Null
        Set-Content (Join-Path $app '.env') 'RUN_WITH=local'
        Set-Content (Join-Path $app 'frontend/package.json') '{ "name": "mortgage-frontend", "version": "1.5.1" }'

        Main

        Should -Invoke Start-InstalledApp -Times 1 -ParameterFilter { $AppDir -eq $app }
        Should -Invoke Write-Host -ParameterFilter { $Object -eq 'Offline: starting the version you have (1.5.1)' }
    }

    It 'does not skip the update when GitHub answers with an error (e.g. too many requests)' {
        New-Item -ItemType Directory -Force (Join-Path $app 'frontend') | Out-Null
        Set-Content (Join-Path $app '.env') 'RUN_WITH=local'
        Mock Invoke-RestMethod { throw [GitHubAnswered]::new() }

        { Main } | Should -Throw '*403*'

        Should -Invoke Start-InstalledApp -Times 0
    }

    It 'stops, saying the first setup needs internet, when nothing is installed' {
        { Main } | Should -Throw '*first setup needs internet*'

        Should -Invoke Start-InstalledApp -Times 0
    }
}

Describe 'the mortgage-management:// link' {
    It 'starts the app' {
        Select-LinkAction @('mortgage-management://start') | Should -Be 'start'
    }

    It 'starts the app with the slash a browser may add' {
        Select-LinkAction @('mortgage-management://start/') | Should -Be 'start'
    }

    It 'updates the app' {
        Select-LinkAction @('mortgage-management://update/') | Should -Be 'update'
    }

    It 'runs Setup for the newest release on update, and the launcher on start' {
        Mock Start-Launcher {}
        Mock Start-Setup {}

        Open-Link @('mortgage-management://update')
        Should -Invoke Start-Setup -Times 1
        Should -Invoke Start-Launcher -Times 0

        Open-Link @('mortgage-management://start')
        Should -Invoke Start-Launcher -Times 1

        Open-Link @('mortgage-management://anything')
        Should -Invoke Start-Setup -Times 1
        Should -Invoke Start-Launcher -Times 1
    }

    It 'does nothing for any other action' {
        Select-LinkAction @('mortgage-management://uninstall') | Should -BeNullOrEmpty
        Select-LinkAction @('mortgage-management://start-everything') | Should -BeNullOrEmpty
        Select-LinkAction @('other://start') | Should -BeNullOrEmpty
    }

    It 'does nothing when anything more is passed' {
        Select-LinkAction @('mortgage-management://start?x=1') | Should -BeNullOrEmpty
        Select-LinkAction @('mortgage-management://start/now') | Should -BeNullOrEmpty
        Select-LinkAction @('mortgage-management://start', '-InstallDir') | Should -BeNullOrEmpty
        Select-LinkAction @() | Should -BeNullOrEmpty
    }
}

Describe 'registering the mortgage-management:// link' {
    BeforeEach {
        Mock Set-UserClassValue {}
        Mock Remove-UserClassKey {}
        if (-not $env:SystemRoot) { $env:SystemRoot = $TestDrive }  # Windows sets it
    }

    It 'is a link Windows opens with the app''s link handler, passing it only the link' {
        Register-AppLink

        Should -Invoke Set-UserClassValue -ParameterFilter {
            $Key -eq 'mortgage-management' -and $Name -eq 'URL Protocol' -and $Value -eq ''
        }
        Should -Invoke Set-UserClassValue -ParameterFilter {
            $Key -eq 'mortgage-management\shell\open\command' -and $Name -eq '' -and
            $Value -like "* -File `"$(Join-Path $AppDir 'windows\link.ps1')`" `"%1`""
        }
    }

    It 'is removed whole' {
        Unregister-AppLink

        Should -Invoke Remove-UserClassKey -Times 1 -ParameterFilter { $Key -eq 'mortgage-management' }
    }
}

Describe 'which Docker images a version runs' {
    It 'is that version''s own release' {
        Select-ImageVersion -Requested '' -Version '1.6.0' | Should -Be '1.6.0'
    }

    It 'is the release the .env asks for, when it names one' {
        Select-ImageVersion -Requested '1.2.0' -Version '1.6.0' | Should -Be '1.2.0'
    }

    It 'is the latest when the version is not known' {
        Select-ImageVersion -Requested '' -Version '' | Should -Be 'latest'
    }
}

Describe 'cleaning up old versions' {
    BeforeAll {
        $versions = Join-Path $TestDrive 'versions'
        $v = @{}
        foreach ($name in '1.4.0', '1.5.0', '1.5.1', '1.6.0', '1.6.0-2') { $v[$name] = Join-Path $versions $name }
    }

    It 'keeps the version now running and the one before it, and removes the rest' {
        $removed = Select-OldVersions -Folders $v.Values -Current $v['1.6.0'] -Previous $v['1.5.1']

        @($removed | Sort-Object) | Should -Be @($v['1.4.0'], $v['1.5.0'], $v['1.6.0-2'])
    }

    It 'never removes a version folder holding the data or Backup folder' {
        $data = Join-Path $v['1.4.0'] 'data'

        $removed = Select-OldVersions -Folders $v.Values -Current $v['1.6.0'] -Previous $v['1.5.1'] -Keeping @($data)

        $removed | Should -Not -Contain $v['1.4.0']
        $removed | Should -Contain $v['1.5.0']
    }
}

Describe 'an install from before versions had folders of their own' {
    BeforeEach {
        $installDir = Join-Path $TestDrive ([guid]::NewGuid())
        $oldApp = Join-Path $installDir 'app'
        $data = Join-Path $installDir 'data'
        New-Item -ItemType Directory -Force (Join-Path $oldApp 'frontend'), $data | Out-Null
        Set-Content (Join-Path $oldApp 'frontend/package.json') '{ "version": "1.5.1" }'
        Set-Content (Join-Path $data 'mortgage.db') 'the records'
        Mock Set-AppJunction {}
    }

    It 'becomes the folder of its version, with its .env, and the app folder points at it' {
        $envText = "RUN_WITH=local`r`nDATA_DIR=$data`r`n"
        Set-Content -NoNewline -Path (Join-Path $oldApp '.env') -Value $envText

        $moved = Move-ToVersionsLayout -InstallDir $installDir

        $moved | Should -Be (Join-Path $installDir 'versions/1.5.1')
        Get-Content -Raw (Join-Path $moved '.env') | Should -Be $envText
        Test-Path $oldApp | Should -BeFalse
        Get-Content -Raw (Join-Path $data 'mortgage.db') | Should -Match 'the records'
        Should -Invoke Set-AppJunction -Times 1 -ParameterFilter { $InstallDir -eq $installDir -and $Target -eq $moved }
    }

    It 'is left as it is when its data folder is inside the app folder, which a switch would leave behind' {
        $inside = Join-Path $oldApp 'data'
        Set-Content (Join-Path $oldApp '.env') "RUN_WITH=local`r`nDATA_DIR=$inside`r`n"

        { Move-ToVersionsLayout -InstallDir $installDir } | Should -Throw '*inside*'

        Test-Path $oldApp | Should -BeTrue
        Should -Invoke Set-AppJunction -Times 0
    }
}

Describe 'installing a new version beside the one running' {
    BeforeEach {
        $InstallDir = Join-Path $TestDrive ([guid]::NewGuid())
        $Mode = 'local'
        $NonInteractive = $true
        $backups = Join-Path $InstallDir 'backups'
        $old = Join-Path $InstallDir 'versions/1.5.1'
        $AppDir = Join-Path $InstallDir 'versions/1.6.0'   # the new version's code, this script's
        New-Item -ItemType Directory -Force (Join-Path $old 'frontend'), (Join-Path $AppDir 'frontend'), $backups | Out-Null
        Set-Content (Join-Path $old 'frontend/package.json') '{ "version": "1.5.1" }'
        Set-Content (Join-Path $AppDir 'frontend/package.json') '{ "version": "1.6.0" }'
        $oldEnv = "# my notes`r`nRUN_WITH=local`r`nDATA_DIR=$(Join-Path $InstallDir 'data')`r`nBACKUP_DIR=$backups`r`n"
        Set-Content -NoNewline -Path (Join-Path $old '.env') -Value $oldEnv

        Mock Write-Host {}
        Mock Get-CurrentVersion { $old }
        Mock Install-Local {}
        Mock Stop-RunningApp { $true }
        Mock Start-Version {}
        Mock Wait-Version { $true }
        Mock Set-AppJunction {}
        Mock Remove-OldVersions {}
        Mock New-DesktopShortcut {}
        Mock Register-AppLink {}
    }

    It 'switches to it once it answers, with the same .env, and the old one''s left as it was' {
        Install-App

        Should -Invoke Start-Version -Times 1 -ParameterFilter { $Folder -eq $AppDir }
        Should -Invoke Set-AppJunction -Times 1 -ParameterFilter { $Target -eq $AppDir }
        Should -Invoke Remove-OldVersions -Times 1
        Should -Invoke Start-Version -Times 0 -ParameterFilter { $Folder -eq $old }
        Get-Content -Raw (Join-Path $AppDir '.env') | Should -Be $oldEnv
        Get-Content -Raw (Join-Path $old '.env') | Should -Be $oldEnv
    }

    It 'stays on the old version, started again, when the new one does not answer' {
        Mock Wait-Version { $false }

        { Install-App } | Should -Throw '*1.6.0 did not start*'

        Should -Invoke Set-AppJunction -Times 0
        Should -Invoke Stop-RunningApp -Times 2  # the old version, then the new one
        Should -Invoke Start-Version -Times 1 -ParameterFilter { $Folder -eq $old }
    }

    It 'leaves the old version running, untouched, when installing the new one fails' {
        Mock Install-Local { throw 'Installing the backend (uv sync) failed (exit code 2).' }

        { Install-App } | Should -Throw '*uv sync*'

        Should -Invoke Stop-RunningApp -Times 0
        Should -Invoke Start-Version -Times 0
        Should -Invoke Set-AppJunction -Times 0
    }

    It 'says which Backup to restore when the new version had already updated the database' {
        Mock Wait-Version { $false }
        Mock Start-Version {
            if ($Folder -eq $AppDir) { Set-Content (Join-Path $backups 'mortgage-backup-2026-10-30-1200-before-update.zip') 'zip' }
        }

        { Install-App } | Should -Throw '*restore*mortgage-backup-2026-10-30-1200-before-update.zip*'
    }

    It 'starts the old version again only if it was running (without Docker)' {
        Mock Wait-Version { $false }
        Mock Stop-RunningApp { $false }

        { Install-App } | Should -Throw

        Should -Invoke Start-Version -Times 0 -ParameterFilter { $Folder -eq $old }
    }

    It 'starts the old version again when starting the new one fails outright' {
        Mock Start-Version { if ($Folder -eq $AppDir) { throw 'Starting the app (docker compose up) failed (exit code 1).' } }

        { Install-App } | Should -Throw '*docker compose up*'

        Should -Invoke Set-AppJunction -Times 0
        Should -Invoke Start-Version -Times 1 -ParameterFilter { $Folder -eq $old }
    }

    It 'stops the old version''s Docker containers when the new one runs without Docker' {
        Set-Content -NoNewline -Path (Join-Path $old '.env') -Value ($oldEnv -replace 'RUN_WITH=local', 'RUN_WITH=docker')

        Install-App

        Should -Invoke Stop-RunningApp -Times 1 -ParameterFilter { $Mode -eq 'docker' -and $Folder -eq $old -and -not $Replaced }
    }

    It 'installs in place, as before, when an older Setup put the new code in the app folder itself' {
        $AppDir = Join-Path $InstallDir 'app'
        New-Item -ItemType Directory -Force (Join-Path $AppDir 'frontend') | Out-Null
        Set-Content -NoNewline -Path (Join-Path $AppDir '.env') -Value $oldEnv
        Mock Get-CurrentVersion { $AppDir }

        Install-App

        Should -Invoke Install-Local -Times 1
        Should -Invoke Stop-RunningApp -Times 0
        Should -Invoke Set-AppJunction -Times 0
        Test-Path (Join-Path $AppDir '.env') | Should -BeTrue
    }

    It 'is simply the app, the first time' {
        Mock Get-CurrentVersion { $null }

        Install-App

        Should -Invoke Set-AppJunction -Times 1 -ParameterFilter { $Target -eq $AppDir }
        Should -Invoke Start-Version -Times 0
        Should -Invoke Remove-OldVersions -Times 0
    }
}

Describe 'Setup updating to a new version' {
    BeforeEach {
        $InstallDir = Join-Path $TestDrive ([guid]::NewGuid())
        $Ref = ''
        $Mode = 'auto'
        $NonInteractive = $true
        $app = Join-Path $InstallDir 'app'
        New-Item -ItemType Directory -Force (Join-Path $app 'frontend') | Out-Null
        Set-Content (Join-Path $app '.env') 'RUN_WITH=local'
        Set-Content (Join-Path $app 'frontend/package.json') '{ "version": "1.5.1" }'
        Mock Write-Host {}
        Mock Get-ReleaseTags { @([pscustomobject]@{ name = '1.6.0' }) }
    }

    It 'stays on the version installed, leaving no trace of the new one, when getting it fails' {
        Mock Get-AppCode {
            param($Ref, $Folder)
            New-Item -ItemType Directory $Folder | Out-Null
            throw 'The download was interrupted.'
        }

        { Main } | Should -Throw 'Update failed; still on 1.5.1*interrupted*'

        Test-Path (Join-Path $InstallDir 'versions/1.6.0') | Should -BeFalse
        Get-Content (Join-Path $app '.env') | Should -Be 'RUN_WITH=local'
    }

    It 'stays on the version installed when installing the new one fails' {
        Mock Get-AppCode {
            param($Ref, $Folder)
            New-Item -ItemType Directory -Force (Join-Path $Folder 'windows') | Out-Null
            Set-Content (Join-Path $Folder 'windows/install.ps1') "throw 'Installing the backend (uv sync) failed.'"
        }

        { Main } | Should -Throw 'Update failed; still on 1.5.1*uv sync*'

        Test-Path (Join-Path $InstallDir 'versions/1.6.0') | Should -BeFalse
    }

    It 'gets the new version into a folder of its own, beside the one installed' {
        Mock Get-AppCode {
            param($Ref, $Folder)
            New-Item -ItemType Directory -Force (Join-Path $Folder 'windows') | Out-Null
            Set-Content (Join-Path $Folder 'windows/install.ps1') "Set-Content (Join-Path `$PSScriptRoot 'ran') `$args"
        }

        Main

        Should -Invoke Get-AppCode -Times 1 -ParameterFilter {
            $Ref -eq '1.6.0' -and $Folder -eq (Join-Path $InstallDir 'versions/1.6.0')
        }
        Test-Path (Join-Path $InstallDir 'versions/1.6.0/windows/ran') | Should -BeTrue
    }
}

# What Invoke-WebRequest throws when GitHub has no such file (a release from before the
# ready-built download).
class NotPublished : Exception {
    [object]$Response = [pscustomobject]@{ StatusCode = 404 }
    NotPublished() : base('Response status code does not indicate success: 404 (Not Found).') {}
}

Describe 'Setup when the version installed is the newest' {
    BeforeEach {
        $InstallDir = Join-Path $TestDrive ([guid]::NewGuid())
        $Ref = ''
        $Mode = 'auto'
        $NonInteractive = $true
        $app = Join-Path $InstallDir 'app'
        New-Item -ItemType Directory -Force (Join-Path $app 'frontend') | Out-Null
        Set-Content (Join-Path $app '.env') 'RUN_WITH=local'
        Set-Content (Join-Path $app 'frontend/package.json') '{ "version": "1.6.0" }'
        Mock Write-Host {}
        Mock Get-ReleaseTags { @([pscustomobject]@{ name = '1.5.1' }, [pscustomobject]@{ name = '1.6.0' }) }
        Mock Get-AppCode {}
        Mock Start-InstalledApp {}
    }

    It 'downloads nothing, and starts it' {
        Main

        Should -Invoke Get-AppCode -Times 0
        Should -Invoke Start-InstalledApp -Times 1 -ParameterFilter { $AppDir -eq $app }
    }

    It 'never goes back to an older release than the version installed' {
        Set-Content (Join-Path $app 'frontend/package.json') '{ "version": "1.7.0" }'

        Main

        Should -Invoke Get-AppCode -Times 0
        Should -Invoke Start-InstalledApp -Times 1
    }

    It 'sets up the release over code from a branch or commit of the same version' {
        Mock Get-JunctionTarget { Join-Path $InstallDir 'versions/3f9a1c2' }
        Mock Get-AppCode { throw 'got it' }

        { Main } | Should -Throw '*got it*'

        Should -Invoke Get-AppCode -Times 1 -ParameterFilter { $Ref -eq '1.6.0' }
    }

    It 'sets the version up again when asked for it by name (to repair it)' {
        $Ref = '1.6.0'
        Mock Get-AppCode { throw 'got it' }

        { Main } | Should -Throw '*got it*'
    }

    It 'still sets up another version when asked for one' {
        $Ref = '1.5.1'
        Mock Get-AppCode { throw 'got it' }

        { Main } | Should -Throw '*got it*'

        Should -Invoke Start-InstalledApp -Times 0
    }
}

Describe 'getting a version''s code' {
    BeforeEach {
        $folder = Join-Path $TestDrive ([guid]::NewGuid())
        $script:fromSource = 0
        Mock Get-AppCodeWithGit { $script:fromSource++ }
        Mock Get-AppCodeDownload { $script:fromSource++ }
    }

    It 'is the ready-built download, for a release that has one' {
        Mock Invoke-WebRequest {
            param($Uri, $OutFile)
            $staging = Join-Path $TestDrive ([guid]::NewGuid())
            $top = Join-Path $staging 'mortgage-management-1.6.0/frontend/dist'
            New-Item -ItemType Directory -Force $top | Out-Null
            Set-Content (Join-Path $top 'index.html') 'the app'
            Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $OutFile
        }

        Get-AppCode '1.6.0' $folder

        Should -Invoke Invoke-WebRequest -Times 1 -ParameterFilter {
            $Uri -eq 'https://github.com/krucx/Mortgage-Management-App/releases/download/1.6.0/mortgage-management-1.6.0.zip'
        }
        Get-Content (Join-Path $folder 'frontend/dist/index.html') | Should -Be 'the app'
        $script:fromSource | Should -Be 0
    }

    It 'is the code itself, for an older release without one' {
        Mock Invoke-WebRequest { throw [NotPublished]::new() }

        Get-AppCode '1.4.0' $folder

        $script:fromSource | Should -Be 1
    }

    It 'is the code itself for a branch or commit, never looking for a download' {
        Mock Invoke-WebRequest {}

        Get-AppCode 'main' $folder

        Should -Invoke Invoke-WebRequest -Times 0
        $script:fromSource | Should -Be 1
    }
}

Describe 'installing without Docker' {
    BeforeAll {
        # Stand-ins for the programs, which Pester can only mock when there is such a command.
        function uv {}
        function npm {}
        function winget {}
    }

    BeforeEach {
        $AppDir = Join-Path $TestDrive ([guid]::NewGuid())
        New-Item -ItemType Directory -Force (Join-Path $AppDir 'backend'), (Join-Path $AppDir 'frontend') | Out-Null
        Mock Write-Host {}
        Mock Test-Command { param($Name) $Name -ne 'node' }  # uv is there, Node is not
        Mock uv { $global:LASTEXITCODE = 0 }
        Mock npm { $global:LASTEXITCODE = 0 }
        Mock winget { $global:LASTEXITCODE = 0 }
        Mock Update-SessionPath {}
    }

    It 'needs no Node, and builds nothing, when the screens come built' {
        New-Item -ItemType Directory -Force (Join-Path $AppDir 'frontend/dist') | Out-Null
        Set-Content (Join-Path $AppDir 'frontend/dist/index.html') 'the app'

        Install-Local

        Should -Invoke uv -Times 1
        Should -Invoke npm -Times 0
        Should -Invoke winget -Times 0
    }

    It 'installs Node and builds the screens from the code otherwise' {
        Install-Local

        Should -Invoke winget -Times 1
        Should -Invoke npm -Times 2
    }
}
