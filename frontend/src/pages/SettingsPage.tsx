import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { GoldRate } from '../api'
import { Summary } from '../components/ConfirmDialog'
import { TermsFields } from '../components/TermsFields'
import { useConfirm } from '../components/useConfirm'
import { useDraft } from '../components/useDraft'
import { WhatsAppPreview } from '../components/WhatsApp'
import { formatDate, formatDateTime } from '../format'
import { formatINR, rupeesToPaise } from '../money'
import { backupsQuery, backUpNow as startBackup, settings } from '../requests'
import { keys, STALE_AFTER, useChange, useServerState } from '../serverState'
import { fromDraft, INTEREST_MODES, PART_MONTH_RULES, toDraft } from '../terms'

export function SettingsPage() {
  return (
    <>
      <DefaultTermsSettings />
      <GoldRateSettings />
      <CallListThresholds />
      <MessageSettingsForm />
      <BackupSettings />
    </>
  )
}

type Status = { kind: 'saved' | 'error'; text: string } | null

/** What saving said, or else why the group could not be loaded. */
const shownStatus = (status: Status, loadError: Error | null): Status =>
  status ?? (loadError ? { kind: 'error', text: loadError.message } : null)

function DefaultTermsSettings() {
  const { client, queryClient } = useServerState()
  const saved = useQuery(settings.defaultTerms(client))
  const [draft, setDraft] = useDraft(saved.data, toDraft)
  const [savedStatus, setStatus] = useState<Status>(null)
  const status = shownStatus(savedStatus, saved.error)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    const confirmed = await confirm({
      title: 'Change the Default Terms?',
      body: (
        <>
          <Summary
            rows={[
              ['Monthly rate', `${draft.ratePercent}%`],
              ['Interest Mode', INTEREST_MODES[draft.interest_mode]],
              ['Part-Month Rule', PART_MONTH_RULES[draft.part_month_rule]],
            ]}
          />
          <p className="hint">Only new Mortgages use these; existing ones keep their Terms.</p>
        </>
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setStatus(null)
    try {
      const terms = await settings.saveDefaultTerms(client, fromDraft(draft))
      queryClient.setQueryData(settings.defaultTerms(client).queryKey, terms)
      setStatus({ kind: 'saved', text: 'Saved. New Mortgages will start with these Terms.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>Default Terms</h2>
      <p className="hint">
        Copied into every new Mortgage when it is created. Changing them never affects existing
        Mortgages.
      </p>

      {draft === null && status === null && <p>Loading…</p>}

      {draft && (
        <form onSubmit={save}>
          <TermsFields value={draft} onChange={setDraft} />
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      {status && <p className={`status ${status.kind}`}>{status.text}</p>}
      {confirmDialog}
    </section>
  )
}

/** The Lender's Gold Rate per gram for each purity, which values every Mortgage. */
/** Each purity's rate in rupees, as typed; blank where none is set. */
const rateDraft = (rates: GoldRate[]): Record<number, string> =>
  Object.fromEntries(
    rates.map((r) => [r.purity_karat, r.rate_per_gram === null ? '' : String(r.rate_per_gram / 100)]),
  )

function GoldRateSettings() {
  const { client, queryClient } = useServerState()
  const saved = useQuery(settings.goldRates(client))
  const rates = saved.data ?? null
  const [draftOrNull, setDraft] = useDraft(saved.data, rateDraft)
  const draft = draftOrNull ?? {}
  const [savedStatus, setStatus] = useState<Status>(null)
  const status = shownStatus(savedStatus, saved.error)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const revalue = useChange(STALE_AFTER.goldRates)

  const filled = (rates ?? []).filter((r) => draft[r.purity_karat])

  async function save(event: FormEvent) {
    event.preventDefault()
    const confirmed = await confirm({
      title: 'Change the Gold Rates?',
      body: (
        <>
          <Summary
            rows={filled.map((r): [string, string] => [
              `${r.purity_karat}K`,
              `${formatINR(rupeesToPaise(draft[r.purity_karat]))} a gram`,
            ])}
          />
          <p className="hint">Every Mortgage valued at the Gold Rate is revalued at once.</p>
        </>
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setStatus(null)
    try {
      const updated = await revalue((client) =>
        settings.saveGoldRates(
          client,
          filled.map((r) => ({
            purity_karat: r.purity_karat,
            rate_per_gram: rupeesToPaise(draft[r.purity_karat]),
          })),
        ),
      )
      queryClient.setQueryData(settings.goldRates(client).queryKey, updated)
      setStatus({ kind: 'saved', text: 'Saved. Collateral Values now use these rates.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>Gold Rates</h2>
      <p className="hint">Per gram of gold, used for each Mortgage's Collateral Value.</p>
      {rates === null && status === null && <p>Loading…</p>}
      {rates && (
        <form onSubmit={save} className="stack">
          <table>
            <thead>
              <tr>
                <th>Purity</th>
                <th>₹ a gram</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.purity_karat}>
                  <td>{rate.purity_karat}K</td>
                  <td>
                    <input
                      type="number"
                      aria-label={`${rate.purity_karat}K Gold Rate (₹ a gram)`}
                      min="0.01"
                      step="0.01"
                      value={draft[rate.purity_karat] ?? ''}
                      onChange={(event) =>
                        setDraft({ ...draft, [rate.purity_karat]: event.target.value })
                      }
                    />
                  </td>
                  <td className="hint">
                    {rate.updated_on ? formatDate(rate.updated_on) : 'Not set'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <button type="submit" disabled={saving || filled.length === 0}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
      {status && <p className={`status ${status.kind}`}>{status.text}</p>}
      {confirmDialog}
    </section>
  )
}

/** When a Mortgage goes on the Call List. */
function CallListThresholds() {
  const { client, queryClient } = useServerState()
  const saved = useQuery(settings.callList(client))
  const [draft, setDraft] = useDraft(saved.data, (thresholds) => thresholds)
  const [savedStatus, setStatus] = useState<Status>(null)
  const status = shownStatus(savedStatus, saved.error)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const relist = useChange(STALE_AFTER.callListThresholds)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    const confirmed = await confirm({
      title: 'Change when Mortgages go on the Call List?',
      body: (
        <Summary
          rows={[
            ['Months Unpaid', `${draft.months_unpaid} or more`],
            ['Loan-to-Value', `above ${draft.loan_to_value_pct}%`],
          ]}
        />
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setStatus(null)
    try {
      const thresholds = await relist((client) => settings.saveCallList(client, draft))
      queryClient.setQueryData(settings.callList(client).queryKey, thresholds)
      setStatus({ kind: 'saved', text: 'Saved.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>Call List</h2>
      <p className="hint">An Active Mortgage is listed when either is reached, or it accrues today.</p>
      {draft && (
        <form onSubmit={save} className="stack">
          <div className="grid-2">
            <label>
              Months Unpaid, or more
              <input
                type="number"
                required
                min="1"
                step="1"
                value={draft.months_unpaid}
                onChange={(event) => setDraft({ ...draft, months_unpaid: Number(event.target.value) })}
              />
            </label>
            <label>
              Loan-to-Value above (%)
              <input
                type="number"
                required
                min="1"
                step="1"
                value={draft.loan_to_value_pct}
                onChange={(event) =>
                  setDraft({ ...draft, loan_to_value_pct: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <div>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
      {status && <p className={`status ${status.kind}`}>{status.text}</p>}
      {confirmDialog}
    </section>
  )
}

/** One editable WhatsApp template, with how its formatting will look. */
function TemplateField({
  label,
  placeholders,
  value,
  onChange,
}: {
  label: string
  /** The placeholders the backend can fill in this template, once they arrive. */
  placeholders?: string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="receipt-panel">
      <label>
        {label}
        <textarea rows={10} required value={value} onChange={(event) => onChange(event.target.value)} />
        <span className="hint">
          {placeholders && (
            <>
              Placeholders: <code>{placeholders.map((name) => `{${name}}`).join(' ')}</code>.{' '}
            </>
          )}
          {'{mortgages}'} is a small table per
          Mortgage, showing its description, never the Mortgage Name. *bold*, _italic_ as in WhatsApp.
        </span>
      </label>
      <WhatsAppPreview text={value} />
    </div>
  )
}

/** The wording of Receipts and Notices, and when Notices are queued. */
function MessageSettingsForm() {
  const { client, queryClient } = useServerState()
  const saved = useQuery(settings.messages(client))
  const placeholders = useQuery(settings.placeholders(client)).data ?? null
  const [draft, setDraft] = useDraft(saved.data, (messages) => messages)
  const [savedStatus, setStatus] = useState<Status>(null)
  const status = shownStatus(savedStatus, saved.error)
  const [saving, setSaving] = useState(false)
  const requeue = useChange(STALE_AFTER.messageSettings)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    setStatus(null)
    try {
      const messages = await requeue((client) => settings.saveMessages(client, draft))
      queryClient.setQueryData(settings.messages(client).queryKey, messages)
      setStatus({ kind: 'saved', text: 'Saved.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card wide">
      <h2>WhatsApp messages</h2>
      <p className="hint">
        Receipts and Notices open in WhatsApp ready to send; you press Send.
      </p>
      {draft && (
        <form onSubmit={save} className="stack">
          <TemplateField
            label="Receipt"
            placeholders={placeholders?.receipt}
            value={draft.receipt_template}
            onChange={(receipt_template) => setDraft({ ...draft, receipt_template })}
          />
          <TemplateField
            label="Notice"
            placeholders={placeholders?.notice}
            value={draft.notice_template}
            onChange={(notice_template) => setDraft({ ...draft, notice_template })}
          />
          <div className="grid-2">
            <label>
              Queue Notices this many days before an Accrual Date
              <input
                type="number"
                required
                min="1"
                max="28"
                step="1"
                value={draft.notice_days_before}
                onChange={(event) =>
                  setDraft({ ...draft, notice_days_before: Number(event.target.value) })
                }
              />
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={draft.notice_approve_first}
                onChange={(event) =>
                  setDraft({ ...draft, notice_approve_first: event.target.checked })
                }
              />
              Approve each Notice before it can be sent
            </label>
          </div>
          <div>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
      {status && <p className={`status ${status.kind}`}>{status.text}</p>}
    </section>
  )
}

/** Backups of the database and photos: when the last one was taken, and how many to keep. */
function BackupSettings() {
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
          The database and photos are zipped into the backup folder; only the last{' '}
          {backup.keep} Backups are kept.
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
        The database and photos are zipped into the backup folder once a week, and before
        every update.
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
                  Backups are not password-protected: set BACKUP_PASSWORD in the .env file.
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
