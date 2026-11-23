import { useEffect, useState } from 'react'
import { Photo } from './Photo'
import { PhotoSource } from './PhotoSource'
import styles from './PhotoPicker.module.css'

/** Choose one photo (e.g. a Customer's), showing the current or newly chosen one. */
export function PhotoPicker({
  currentUrl,
  onChange,
}: {
  currentUrl: string | null
  onChange: (photo: Blob | null) => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  return (
    <div className={styles.picker} role="group" aria-label="Photo">
      <Photo url={preview ?? currentUrl} alt="Customer" />
      <PhotoSource
        onPhotos={([photo]) => {
          setPreview(URL.createObjectURL(photo))
          onChange(photo)
        }}
      />
    </div>
  )
}
