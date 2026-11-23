import { useEffect, useState } from 'react'
import type { IdCard } from '../../api'
import type { Customer } from '../../api'
import { Photo } from '../../components/Photo'
import { PhotoSource } from '../../components/PhotoSource'
import { ID_CARDS, type IdPhotoChange } from './idCards'

/** One ID Photo on the form: the current or newly chosen photo, a way to choose one,
 *  and Remove. Nothing is uploaded or removed until Save. */
function IdPhotoPicker({
  label,
  currentUrl,
  change,
  onChange,
}: {
  label: string
  currentUrl: string | null
  change: IdPhotoChange
  onChange: (change: IdPhotoChange) => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  const shown = change.kind === 'remove' ? null : change.kind === 'new' ? preview : currentUrl
  return (
    <fieldset className="stack id-photo-picker">
      <legend>{label}</legend>
      <Photo url={shown} alt={label} />
      <PhotoSource
        onPhotos={([photo]) => {
          setPreview(URL.createObjectURL(photo))
          onChange({ kind: 'new', photo })
        }}
      />
      {shown && (
        <div>
          <button
            type="button"
            className="secondary small"
            onClick={() => onChange({ kind: 'remove' })}
          >
            Remove
          </button>
        </div>
      )}
    </fieldset>
  )
}

/** The Aadhaar and PAN card photos side by side. */
export function IdPhotos({
  existing,
  changes,
  onChange,
}: {
  existing: Customer | null
  changes: Record<IdCard, IdPhotoChange>
  onChange: (card: IdCard, change: IdPhotoChange) => void
}) {
  return (
    <div className="grid-2">
      {ID_CARDS.map(({ card, label, urlOf }) => (
        <IdPhotoPicker
          key={card}
          label={label}
          currentUrl={existing ? urlOf(existing) : null}
          change={changes[card]}
          onChange={(change) => onChange(card, change)}
        />
      ))}
    </div>
  )
}
