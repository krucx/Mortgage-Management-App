/** The largest photo the backend takes (its own limit is on the whole request). */
const MAX_PHOTO_BYTES = 20 * 1024 * 1024

/** A photo as the request body the backend takes: the schema types the file as a
 *  string, but it is sent as multipart form data. One too large is refused here, before
 *  it is sent: the backend refuses it without reading it, which the browser may report
 *  as the connection failing rather than with the backend's answer. */
export function photoBody(photo: Blob) {
  if (photo.size > MAX_PHOTO_BYTES) throw new Error('The photo is too large (over 20 MB).')
  return {
    body: { photo: '' },
    bodySerializer: () => fileForm('photo', photo, 'photo.jpg'),
  }
}

/** A file as the multipart form field `field`. */
export function fileForm(field: string, file: Blob, name: string): FormData {
  const form = new FormData()
  form.append(field, file, name)
  return form
}
