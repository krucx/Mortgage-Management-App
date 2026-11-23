import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'

const reloadPage = () => window.location.reload()

interface Failure {
  error: Error
  componentStack: string
}

/** Catches an error thrown while its children render, and shows what happened in their place. */
class Boundary extends Component<{ children: ReactNode }, { failure: Failure | null }> {
  state = { failure: null as Failure | null }

  static getDerivedStateFromError(error: Error) {
    return { failure: { error, componentStack: '' } }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    this.setState({ failure: { error, componentStack: info.componentStack ?? '' } })
  }

  render() {
    const { failure } = this.state
    return failure ? <PageFailed {...failure} /> : this.props.children
  }
}

/** What the Lender sees when a page can't be displayed: ways on, and the details for whoever helps. */
function PageFailed({ error, componentStack }: Failure) {
  return (
    <section className="card" role="alert">
      <h2>This page could not be displayed</h2>
      <p>Something went wrong while showing this page. Your records are not affected.</p>
      <div className="row">
        <button type="button" onClick={reloadPage}>
          Reload page
        </button>
        <Link className="button secondary" to="/">
          Return to Dashboard
        </Link>
      </div>
      <details className="tucked">
        <summary>Technical details</summary>
        <pre>{error.message}</pre>
        <p>Component stack</p>
        <pre>{componentStack.trim()}</pre>
      </details>
    </section>
  )
}

/** Shows `children` (the pages), or the failure of one, which clears on the next navigation. */
export function PageErrorBoundary({ children }: { children: ReactNode }) {
  // Keyed on the location, not the address: going to the address already shown (Return to
  // Dashboard, from a Dashboard that failed) must clear the failure too.
  const { key } = useLocation()
  return <Boundary key={key}>{children}</Boundary>
}
