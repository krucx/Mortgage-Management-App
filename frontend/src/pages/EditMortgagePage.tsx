import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, PURITIES, type Mortgage, type Purity } from '../api'
import { PreviewSection } from '../components/BeforeAfter'
import { Summary } from '../components/ConfirmDialog'
import { useConfirm } from '../components/useConfirm'
import { usePreview } from '../components/usePreview'
import { formatDate, formatGrams, todayIso } from '../format'
import { formatINR, rupeesToPaise } from '../money'

const gramsToMg = (grams: string) => Math.round(Number(grams) * 1000)
const mgToGrams = (mg: number) => String(mg / 1000)

/** Correct a Mortgage's details; the Ledger is recalculated from them. */
export function EditMortgagePage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const [mortgage, setMortgage] = useState<Mortgage | null>(null)
  const [fields, setFields] = useState({
    name: '',
    start_date: '',
    amountLent: '',
    description: '',
    gross: '',
    net: '',
    purity: 22 as Purity,
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  useEffect(() => {
    api.getMortgage(id).then(
      (loaded) => {
        setMortgage(loaded)
        setFields({
          name: loaded.name,
          start_date: loaded.start_date,
          amountLent: String(loaded.amount_lent / 100),
          description: loaded.description,
          gross: mgToGrams(loaded.gross_weight_mg),
          net: mgToGrams(loaded.net_weight_mg),
          purity: loaded.purity_karat,
        })
      },
      (err: Error) => setError(err.message),
    )
  }, [id])

  // Only the start date and Principal change what is owed: preview those.
  const numbersChanged =
    mortgage !== null &&
    Number(fields.amountLent) > 0 &&
    (fields.start_date !== mortgage.start_date ||
      rupeesToPaise(fields.amountLent) !== mortgage.amount_lent)
  const proposed = numbersChanged
    ? JSON.stringify({
        name: fields.name.trim(),
        start_date: fields.start_date,
        amount_lent: rupeesToPaise(fields.amountLent),
        description: fields.description,
        gross_weight_mg: gramsToMg(fields.gross),
        net_weight_mg: gramsToMg(fields.net),
        purity_karat: fields.purity,
      })
    : ''
  const load = useCallback(() => api.previewEdit(id, JSON.parse(proposed)), [id, proposed])
  const preview = usePreview(proposed ? load : null)

  if (!mortgage) return error ? <p className="status error">{error}</p> : <p>Loading…</p>

  const edited = {
    name: fields.name.trim(),
    start_date: fields.start_date,
    amount_lent: rupeesToPaise(fields.amountLent),
    description: fields.description,
    gross_weight_mg: gramsToMg(fields.gross),
    net_weight_mg: gramsToMg(fields.net),
    purity_karat: fields.purity,
  }
  const was = mortgage
  const changes: [string, string][] = [
    ['Name', was.name, edited.name],
    ['Start date', formatDate(was.start_date), formatDate(edited.start_date || was.start_date)],
    ['Principal lent', formatINR(was.amount_lent), formatINR(edited.amount_lent)],
    ['Jewellery', was.description, edited.description],
    ['Gross weight', formatGrams(was.gross_weight_mg), formatGrams(edited.gross_weight_mg)],
    ['Net weight', formatGrams(was.net_weight_mg), formatGrams(edited.net_weight_mg)],
    ['Purity', `${was.purity_karat}K`, `${edited.purity_karat}K`],
  ]
    .filter(([, before, after]) => before !== after)
    .map(([label, before, after]): [string, string] => [label, `${before} → ${after}`])
  const closed = mortgage.status !== 'active'

  const set = (field: keyof typeof fields) => (value: string) =>
    setFields({ ...fields, [field]: value })

  async function save(event: FormEvent) {
    event.preventDefault()
    const confirmed = await confirm({
      title: `Save changes to ${was.name}?`,
      body: (
        <>
          <Summary rows={changes} />
          {changes.some(([label]) => label === 'Start date' || label === 'Principal lent') && (
            <p className="hint">The Ledger and what is owed are recalculated.</p>
          )}
        </>
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setError(null)
    try {
      await api.editMortgage(id, edited)
      navigate(`/mortgages/${id}`)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <section className="card wide">
      <h2>Edit {mortgage.name}</h2>
      <p className="hint">
        Customer and Terms are not changed here.
        {closed &&
          ` It is ${mortgage.status}, so its start date and Principal stay as they were; ` +
            'reopen it to change them.'}
      </p>
      <form onSubmit={save}>
        <label>
          Mortgage Name
          <input required value={fields.name} onChange={(e) => set('name')(e.target.value)} />
        </label>
        <div className="grid-2">
          <label>
            Start date
            <input
              type="date"
              required
              max={todayIso()}
              disabled={closed}
              value={fields.start_date}
              onChange={(e) => set('start_date')(e.target.value)}
            />
          </label>
          <label>
            Principal lent (₹)
            <input
              type="number"
              required
              min="1"
              step="0.01"
              disabled={closed}
              value={fields.amountLent}
              onChange={(e) => set('amountLent')(e.target.value)}
            />
          </label>
        </div>
        <label>
          Description of the jewellery
          <textarea
            rows={2}
            required
            value={fields.description}
            onChange={(e) => set('description')(e.target.value)}
          />
        </label>
        <div className="grid-3">
          <label>
            Gross weight (g)
            <input
              type="number"
              required
              min="0.001"
              step="0.001"
              value={fields.gross}
              onChange={(e) => set('gross')(e.target.value)}
            />
          </label>
          <label>
            Net weight, gold only (g)
            <input
              type="number"
              required
              min="0.001"
              step="0.001"
              max={fields.gross || undefined}
              value={fields.net}
              onChange={(e) => set('net')(e.target.value)}
            />
          </label>
          <label>
            Purity
            <select
              value={fields.purity}
              onChange={(e) => setFields({ ...fields, purity: Number(e.target.value) as Purity })}
            >
              {PURITIES.map((karat) => (
                <option key={karat} value={karat}>
                  {karat}K
                </option>
              ))}
            </select>
          </label>
        </div>
        {numbersChanged && (
          <>
            <h3>What changes</h3>
            <PreviewSection preview={preview} />
          </>
        )}
        <div className="row">
          <button type="submit" disabled={saving || changes.length === 0 || !!preview.error}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
        {error && <p className="status error">{error}</p>}
      </form>
      {confirmDialog}
    </section>
  )
}
