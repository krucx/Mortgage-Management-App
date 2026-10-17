export function Photo({ url, alt }: { url: string | null; alt: string }) {
  return url ? (
    <img src={url} alt={alt} className="photo" />
  ) : (
    <div className="photo placeholder">No photo</div>
  )
}
