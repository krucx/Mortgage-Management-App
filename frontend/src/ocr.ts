// Reading the text on a photo, in the browser with Tesseract: nothing leaves the
// laptop. Its worker, engine and English data are served with the app's screens
// (copied into public/ocr by scripts/copy-ocr.mjs), never fetched from elsewhere.

let worker: Promise<import('tesseract.js').Worker> | null = null

/** The text on `image`, as Tesseract reads it; the reader is loaded on first use. */
export async function readText(image: Blob): Promise<string> {
  worker ??= import('tesseract.js').then(({ createWorker }) =>
    createWorker('eng', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr',
      langPath: '/ocr',
      workerBlobURL: false,
    }),
  )
  try {
    const { data } = await (await worker).recognize(image)
    return data.text
  } catch (error) {
    worker = null // try loading the reader again next time
    throw error
  }
}
