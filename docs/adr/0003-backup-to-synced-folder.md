# Backups go to a cloud-synced folder, not email

The spec asked for a weekly backup emailed as an attachment. We instead write an encrypted zip (database + photos) to a cloud-synced folder (Google Drive / iCloud) on app startup whenever the last backup is 7+ days old, keeping the last N. Email breaks past the 25 MB attachment limit once photos accumulate, requires storing an SMTP password, leaves Customer personal data in a mailbox, and "every Sunday" can't be honoured without background processes anyway.
