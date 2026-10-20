# The Windows uninstall script's own decisions, without stopping or deleting anything.
# Run with Pester 5: Invoke-Pester windows/tests

BeforeAll {
    $windows = Split-Path -Parent $PSScriptRoot
    . (Join-Path $windows 'uninstall.ps1')   # dot-sourced: defines its functions, runs nothing

    function New-File {
        param([string]$Name, [datetime]$Written)
        $file = New-Item -ItemType File -Force (Join-Path $TestDrive $Name)
        $file.LastWriteTime = $Written
        return $file
    }
}

Describe 'the Backup kept' {
    BeforeEach { Get-ChildItem $TestDrive | Remove-Item -Recurse -Force }

    It 'is the most recently written Backup zip' {
        New-File 'mortgage-backup-2026-10-19-0900.zip' '2026-10-19 09:00'
        New-File 'mortgage-backup-2026-10-20-0900-before-update.zip' '2026-10-20 09:00'
        New-File 'mortgage-backup-2026-10-18-0900.zip' '2026-10-18 09:00'

        (Select-LatestBackup $TestDrive).Name |
            Should -Be 'mortgage-backup-2026-10-20-0900-before-update.zip'
    }

    It 'is never a half-written Backup or some other file' {
        New-File 'mortgage-backup-2026-10-19-0900.zip' '2026-10-19 09:00'
        New-File '.mortgage-backup-2026-10-20-0900.zip.partial' '2026-10-20 09:00'
        New-File 'holiday-photos.zip' '2026-10-20 10:00'

        (Select-LatestBackup $TestDrive).Name | Should -Be 'mortgage-backup-2026-10-19-0900.zip'
    }

    It 'is nothing when there is no Backup, or no Backup folder' {
        New-File 'notes.txt' '2026-10-20 09:00'

        Select-LatestBackup $TestDrive | Should -BeNullOrEmpty
        Select-LatestBackup (Join-Path $TestDrive 'missing') | Should -BeNullOrEmpty
    }
}

Describe 'keeping the Backup' {
    BeforeEach {
        Get-ChildItem $TestDrive | Remove-Item -Recurse -Force
        $backups = New-Item -ItemType Directory (Join-Path $TestDrive 'backups')
        $documents = New-Item -ItemType Directory (Join-Path $TestDrive 'Documents')
    }

    It 'moves it into the folder, by its own name' {
        $backup = New-Item -ItemType File (Join-Path $backups 'mortgage-backup-2026-10-20-0900.zip') -Value 'latest'

        $kept = Save-BackupTo $backup $documents

        $kept | Should -Be (Join-Path $documents 'mortgage-backup-2026-10-20-0900.zip')
        Get-Content $kept | Should -Be 'latest'
        Test-Path $backup.FullName | Should -BeFalse
    }

    It 'never overwrites a file of the same name already there' {
        New-Item -ItemType File (Join-Path $documents 'mortgage-backup-2026-10-20-0900.zip') -Value 'older' | Out-Null
        New-Item -ItemType File (Join-Path $documents 'mortgage-backup-2026-10-20-0900 (2).zip') -Value 'older too' | Out-Null
        $backup = New-Item -ItemType File (Join-Path $backups 'mortgage-backup-2026-10-20-0900.zip') -Value 'latest'

        $kept = Save-BackupTo $backup $documents

        $kept | Should -Be (Join-Path $documents 'mortgage-backup-2026-10-20-0900 (3).zip')
        Get-Content $kept | Should -Be 'latest'
        Get-Content (Join-Path $documents 'mortgage-backup-2026-10-20-0900.zip') | Should -Be 'older'
    }

    It 'copies it instead, from a Backup folder that stays (a synced one keeps its copy)' {
        $backup = New-Item -ItemType File (Join-Path $backups 'mortgage-backup-2026-10-20-0900.zip') -Value 'latest'

        $kept = Save-BackupTo $backup $documents -LeaveOriginal

        Get-Content $kept | Should -Be 'latest'
        Get-Content $backup.FullName | Should -Be 'latest'
    }
}

Describe 'stopping the app before it is removed' {
    BeforeAll {
        function New-Process {
            param([int]$Id, [int]$Parent, [string]$Path, [string]$CommandLine)
            [pscustomobject]@{ ProcessId = $Id; ParentProcessId = $Parent
                               ExecutablePath = $Path; CommandLine = $CommandLine }
        }
        $app = 'C:\Users\Asha Rao\MortgageManagement\app'
        # Run.bat's window running the app without Docker, and the uninstaller started from
        # the same folder; Explorer is the parent of both.
        $processes = @(
            New-Process 10 1 'C:\Windows\explorer.exe' 'C:\Windows\explorer.exe'
            New-Process 20 10 'C:\Windows\System32\cmd.exe' "cmd /c `"$app\windows\Run.bat`""
            New-Process 21 20 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' "powershell -File `"$app\windows\run.ps1`""
            New-Process 22 21 "$app\backend\.venv\Scripts\python.exe" 'python.exe -m uvicorn mortgage_backend.main:app'
            New-Process 23 21 'C:\Program Files\nodejs\node.exe' 'node node_modules/vite/bin/vite.js preview'
            New-Process 30 10 'C:\Windows\System32\cmd.exe' "cmd /c `"$app\windows\Uninstall.bat`""
            New-Process 31 30 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' "powershell -File `"$app\windows\uninstall.ps1`""
            New-Process 40 10 'C:\Program Files\nodejs\node.exe' 'node C:\Users\Asha Rao\MortgageManagement\apple\server.js'
        )
    }

    It 'stops what runs from the app folder, and what that started' {
        Select-AppProcessIds -Processes $processes -AppDir $app -Self 31 |
            Sort-Object | Should -Be @(20, 21, 22, 23)
    }

    It 'never stops the uninstaller, or the window it runs in' {
        Select-AppProcessIds -Processes $processes -AppDir "$app\" -Self 31 |
            Should -Not -Contain 30
    }
}
