import { Link, useLocation } from 'react-router'

/** What was asked for isn't here: `title` says what, with the address and ways back. */
export function NotFound({ title }: { title: string }) {
  const { pathname, search } = useLocation()
  return (
    <section className="card">
      <h2>{title}</h2>
      <p>
        Nothing was found at <code>{pathname + search}</code>.
      </p>
      <div className="row">
        <Link className="button" to="/">
          Dashboard
        </Link>
        <Link className="button secondary" to="/customers">
          Customers
        </Link>
      </div>
    </section>
  )
}

/** An address the app has no page for. */
export function NotFoundPage() {
  return <NotFound title="Page not found" />
}
