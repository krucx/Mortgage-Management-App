import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Summary } from '../../components/ConfirmDialog'
import { useConfirm } from '../../components/useConfirm'
import { useDraft } from '../../components/useDraft'
import { formatDateTime } from '../../format'
import { backupsQuery, backUpNow as startBackup, settings } from '../../requests'
import { keys, useServerState } from '../../serverState'
import { type Status, shownStatus } from './shared'

/** Backups of the database and photos: when the last one was taken, and how many to keep. */
export function BackupSettings() {
  const { client, queryClient } = useServerState()
  // Checked every second while a Backup runs in the background.
  const loaded = useQuery(backupsQuery(client))
  const backup = loaded.data ?? null
  // How many to keep, as typed; starts again from what is saved only when that changes.
  const [keepDraft, setKeep] = useDraft(backup?.keep, String)
  const keep = keepDraft ?? ''
  const [savedStatus, setStatus] = useState<Status>(null)
  const status = shownStatus(savedStatus, loaded.error)
  const [confirm, confirmDialog] = useConfirm()
  const setBackup = (changed: NonNullable<typeof backup>) =>
    queryClient.setQueryData(keys.backups, changed)

  async function backUpNow() {
    if (!backup) return
    const confirmed = await confirm({
      title: 'Back up now?',
      body: (
        <p>
          The database and photos are zipped into the backup folder; only the last {backup.keep}{' '}
          Backups are kept.
        </p>
      ),
      confirmLabel: 'Back up',
      cancelLabel: 'Cancel',
    })
    if (!confirmed) return
    setStatus(null)
    try {
      setBackup(await startBackup(client))
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    }
  }

  async function saveKeep(event: FormEvent) {
    event.preventDefault()
    const confirmed = await confirm({
      title: 'Change how many Backups are kept?',
      body: (
        <>
          <Summary rows={[['Keep the last', keep]]} />
          <p className="hint">Older Backups are deleted after the next one is taken.</p>
        </>
      ),
    })
    if (!confirmed) return
    setStatus(null)
    try {
      setBackup(await settings.saveBackups(client, Number(keep)))
      setStatus({ kind: 'saved', text: 'Saved.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    }
  }

  return (
    <section className="card">
      <h2>Backups</h2>
      <p className="hint">
        The database and photos are zipped into the backup folder once a week, and before every
        update.
      </p>
      {backup && (
        <div className="stack">
          {!backup.enabled ? (
            <p className="status error">No backup folder is set up (BACKUP_DIR).</p>
          ) : (
            <>
              <p>
                {backup.running ? (
                  <strong>Backing up…</strong>
                ) : backup.last_backup_at ? (
                  <>
                    Last Backup <strong>{formatDateTime(backup.last_backup_at)}</strong>{' '}
                    <span className="hint">{backup.last_backup_file}</span>
                  </>
                ) : (
                  'No Backup yet.'
                )}
              </p>
              {backup.last_error && !backup.running && (
                <p className="status error">The last Backup failed: {backup.last_error}</p>
              )}
              {!backup.encrypted && (
                <p className="status error">
                  Backups are not password-protected: set BACKUP_PASSWORD in the .env file. Backups
                  hold Customers' ID Photos: keep the Backup folder private.
                </p>
              )}
              <div>
                <button type="button" onClick={backUpNow} disabled={backup.running}>
                  Back up now
                </button>
              </div>
            </>
          )}
          <form onSubmit={saveKeep} className="row align-end">
            <label>
              Keep the last
              <input
                type="number"
                required
                min="1"
                step="1"
                value={keep}
                onChange={(event) => setKeep(event.target.value)}
              />
            </label>
            <button type="submit" className="secondary">
              Save
            </button>
          </form>
        </div>
      )}
      {status && <p className={`status ${status.kind}`}>{status.text}</p>}
      {confirmDialog}
    </section>
  )
}
