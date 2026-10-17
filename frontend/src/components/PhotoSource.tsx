import { useEffect, useRef, useState } from 'react'

/** Buttons to add photos by file upload or by taking one with the laptop webcam. */
export function PhotoSource({
  onPhotos,
  multiple = false,
}: {
  onPhotos: (photos: Blob[]) => void
  multiple?: boolean
}) {
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)

  const stopCamera = () => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    setCameraOn(false)
  }

  useEffect(() => stopCamera, [])

  async function startCamera() {
    setCameraError(null)
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: true })
      setCameraOn(true)
      requestAnimationFrame(() => {
        if (video.current) video.current.srcObject = stream.current
      })
    } catch {
      setCameraError('Could not open the webcam. Check the browser permission.')
    }
  }

  function capture() {
    const frame = video.current
    if (!frame) return
    const canvas = document.createElement('canvas')
    canvas.width = frame.videoWidth
    canvas.height = frame.videoHeight
    canvas.getContext('2d')?.drawImage(frame, 0, 0)
    canvas.toBlob((blob) => blob && onPhotos([blob]), 'image/jpeg', 0.9)
    stopCamera()
  }

  return (
    <div className="stack">
      {cameraOn && <video ref={video} autoPlay playsInline muted className="photo" />}
      <div className="row">
        {cameraOn ? (
          <>
            <button type="button" onClick={capture}>
              Capture
            </button>
            <button type="button" className="secondary" onClick={stopCamera}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <label className="button secondary">
              {multiple ? 'Upload photos' : 'Upload photo'}
              <input
                type="file"
                accept="image/*"
                multiple={multiple}
                hidden
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])]
                  if (files.length) onPhotos(files)
                  event.target.value = '' // allow choosing the same file again
                }}
              />
            </label>
            <button type="button" className="secondary" onClick={startCamera}>
              Use webcam
            </button>
          </>
        )}
      </div>
      {cameraError && <p className="status error">{cameraError}</p>}
    </div>
  )
}
