/** "Showing 1–20 of 45" with Previous / Next. */
export function Pager({
  page,
  pageSize,
  total,
  shown,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  shown: number
  onPage: (page: number) => void
}) {
  if (total === 0) return null
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const first = (page - 1) * pageSize + 1
  return (
    <div className="row spread">
      <span className="hint">
        Showing {first}–{first + shown - 1} of {total}
      </span>
      <div className="row">
        <button
          type="button"
          className="secondary small"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="secondary small"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
