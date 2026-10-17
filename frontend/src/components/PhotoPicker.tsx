import { useEffect, useRef, useState } from 'react'
import { Photo } from './Photo'

/** Choose a photo by file upload or by taking one with the laptop webcam. */
export function PhotoPicker({
  currentUrl,
  onChange,
}: {
  currentUrl: string | null
  onChange: (photo: Blob | null) => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
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
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  function choose(photo: Blob) {
    setPreview(URL.createObjectURL(photo))
    onChange(photo)
  }

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
    canvas.toBlob((blob) => blob && choose(blob), 'image/jpeg', 0.9)
    stopCamera()
  }

  const shown = preview ?? currentUrl

  return (
    <div className="photo-picker">
      {cameraOn ? (
        <video ref={video} autoPlay playsInline muted className="photo" />
      ) : (
        <Photo url={shown} alt="Customer" />
      )}
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
              Upload photo
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => event.target.files?.[0] && choose(event.target.files[0])}
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
