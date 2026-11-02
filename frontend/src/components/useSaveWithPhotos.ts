import { useRef, useState } from 'react'
import { useChange, type ApiClient } from '../serverState'

/** One photo change to send once the record is saved: `key` tells it apart on a retry
 *  (the photo itself, or a marker for a removal). */
export interface PhotoUpload {
  key: unknown
  send: (client: ApiClient, id: number) => Promise<unknown>
}

/**
 * Save a record, then send its photos: `await run(save, uploads)`. What has been saved
 * and sent is remembered, so a retry after a failed photo sends only what is left and
 * never saves the record again. `id` is a record already there (photos added to it);
 * each photo sent makes `stale` stale. Resolves to the record's id once all of it is
 * sent, or undefined with `error` set.
 */
export function useSaveWithPhotos<Saved extends { id: number }>({
  noun,
  stale,
  id,
}: {
  /** What the record is, for "Mortgage saved, but a photo failed". */
  noun: string
  stale: readonly (readonly unknown[])[]
  id?: number
}) {
  const sendPhoto = useChange(stale)
  // Refs, not only state: a retry must see what the last attempt did straight away.
  const savedId = useRef<number | undefined>(undefined)
  const sent = useRef(new Set<unknown>())
  const [saved, setSaved] = useState<number>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(
    save: (() => Promise<Saved>) | null,
    uploads: PhotoUpload[],
  ): Promise<number | undefined> {
    setSaving(true)
    setError(null)
    try {
      let recordId = id ?? savedId.current
      if (recordId === undefined) {
        if (!save) throw new Error(`There is no ${noun} to add photos to`)
        recordId = (await save()).id
        savedId.current = recordId
        setSaved(recordId)
      }
      for (const upload of uploads) {
        if (sent.current.has(upload.key)) continue
        await sendPhoto((client) => upload.send(client, recordId))
        sent.current.add(upload.key)
      }
      return recordId
    } catch (err) {
      const message = (err as Error).message
      // Saved by this form (not a record that was already there): say so.
      setError(
        id === undefined && savedId.current !== undefined
          ? `${noun} saved, but a photo failed: ${message}`
          : message,
      )
      return undefined
    } finally {
      setSaving(false)
    }
  }

  return {
    run,
    /** The record's id once saved (or the one already there). */
    savedId: id ?? saved,
    saving,
    /** Why the last attempt stopped. */
    error,
    clearError: () => setError(null),
    /** Whether the photo change with `key` has been sent. */
    isSent: (key: unknown) => sent.current.has(key),
  }
}
