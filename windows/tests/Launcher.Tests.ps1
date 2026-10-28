# The Windows setup and run scripts' own decisions, without installing or starting anything.
# Run with Pester 5: Invoke-Pester windows/tests

BeforeAll {
    $windows = Split-Path -Parent $PSScriptRoot
    . (Join-Path $windows 'common.ps1')
    . (Join-Path $windows 'setup.ps1')   # dot-sourced: defines its functions, runs nothing
    . (Join-Path $windows 'install.ps1') -InstallDir $windows -Mode local -NonInteractive
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
