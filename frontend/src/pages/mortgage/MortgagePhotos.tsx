import { useState } from 'react'
import type { Mortgage } from '../../api'
import { Photo } from '../../components/Photo'
import { PhotoSource } from '../../components/PhotoSource'
import { useConfirm } from '../../components/useConfirm'
import { useSaveWithPhotos } from '../../components/useSaveWithPhotos'
import { addMortgagePhoto, removeMortgagePhoto } from '../../requests'
import { STALE_AFTER, useChange } from '../../serverState'

/** The Mortgage's photos, to open, add to or delete from; a refusal is shown with them. */
export function MortgagePhotos({ mortgage }: { mortgage: Mortgage }) {
  const { id } = mortgage
  const [error, setError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const photos = useSaveWithPhotos<Mortgage>({
    noun: 'Mortgage',
    stale: STALE_AFTER.mortgagePhoto,
    id,
  })
  const changePhotos = useChange(STALE_AFTER.mortgagePhoto)

  async function add(blobs: Blob[]) {
    setError(null)
    try {
      await photos.run(
        null,
        blobs.map((blob) => ({
          key: blob,
          send: (client, id) => addMortgagePhoto(client, id, blob),
        })),
      )
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove(photoId: number) {
    const confirmed = await confirm({
      title: 'Delete this photo?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!confirmed) return
    setError(null)
    try {
      await changePhotos((client) => removeMortgagePhoto(client, id, photoId))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      {mortgage.photos.length > 0 ? (
        <div className="gallery">
          {mortgage.photos.map((photo, index) => (
            <div key={photo.id} className="gallery-item">
              <a href={photo.url} target="_blank" rel="noreferrer">
                <Photo url={photo.url} alt={`Photo ${index + 1}`} />
              </a>
              <button type="button" className="danger small" onClick={() => remove(photo.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">No photos yet.</p>
      )}
      {error && <p className="status error">{error}</p>}
      <PhotoSource multiple onPhotos={add} />
      {confirmDialog}
    </>
  )
}
