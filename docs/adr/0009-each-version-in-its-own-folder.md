# Each version is installed in a folder of its own, and `app` is a junction to the one that runs

An update that failed partway used to leave the Lender with a broken app: Setup replaced the code in `MortgageManagement\app` and then installed into it. Setup now puts each version in `MortgageManagement\versions\<version>`, installs it there while the version before keeps running, starts it, and only once it answers points `MortgageManagement\app`, a Windows directory junction, at it. The Desktop shortcut, the `mortgage-management://` link, `app\.env`, `app\windows\Uninstall.bat` and Docker's project name (`app`) therefore keep their paths across updates. Each version gets a copy of the `.env` of the one before, which is left as it was, so going back needs nothing changed; with Docker each version runs its own release's images (unless `APP_VERSION` says otherwise), so going back runs the old images, not `:latest`. The version before is kept; older ones are removed.

A database update cannot be undone this way: once the new version has migrated the database, the old one will not start on it. Setup then says which `-before-update` Backup to restore, rather than restoring it by itself.

## Considered Options

- **Rewrite the shortcut and link to point into `versions\<version>` at each switch, with the `.env` beside `versions`**: rejected because every path in the docs (`app\.env`, `app\windows`) would change, Docker would need an explicit project name and `--env-file`, and `Uninstall.bat` would move with each version.
- **Restore the `-before-update` Backup automatically when the new version fails after migrating**: rejected for now because Setup would change the Lender's data on its own, and with Docker the Backups are password zips.
