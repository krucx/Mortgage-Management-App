import type { IdCard } from '../../api'

type Reading = 'reading' | 'read' | null

function ReadHint({ state }: { state: Reading }) {
  if (state === 'reading') return <span className="hint">Reading the photo…</span>
  if (state === 'read')
    return <span className="status warning">Read from the photo: check it.</span>
  return null
}

/** The Aadhaar Number (last 4 digits) and PAN fields, with a hint when a number was read
 *  from its ID Photo. */
export function IdNumberFields({
  aadhaar,
  pan,
  read,
  onChange,
}: {
  aadhaar: string
  pan: string
  read: Record<IdCard, Reading>
  onChange: (card: IdCard, value: string) => void
}) {
  return (
    <div className="grid-2">
      <div className="stack">
        <label>
          Aadhaar Number: last 4 digits (optional)
          <input
            inputMode="numeric"
            placeholder="1234"
            aria-describedby="aadhaar-hint"
            value={aadhaar}
            onChange={(event) => onChange('aadhaar', event.target.value)}
          />
        </label>
        <ReadHint state={read.aadhaar} />
        <span className="hint" id="aadhaar-hint">
          Only the last 4 digits are kept. Ask for the Customer's masked Aadhaar.
        </span>
      </div>
      <div className="stack">
        <label>
          PAN (optional)
          <input
            placeholder="ABCDE1234F"
            value={pan}
            onChange={(event) => onChange('pan', event.target.value.toUpperCase())}
          />
        </label>
        <ReadHint state={read.pan} />
      </div>
    </div>
  )
}
