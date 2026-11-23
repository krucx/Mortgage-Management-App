import { Component, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { InvalidRouteIdError } from '../useNumericId'
import { NotFoundPage } from '../pages/NotFoundPage'

/** Shows Page not found for an address whose id isn't a valid number; resets on navigation. */
export function UnknownIdBoundary({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation()
  return <Boundary key={pathname + search}>{children}</Boundary>
}

class Boundary extends Component<{ children: ReactNode }, { invalid: boolean }> {
  state = { invalid: false }

  static getDerivedStateFromError(error: unknown) {
    if (error instanceof InvalidRouteIdError) return { invalid: true }
    throw error
  }

  render() {
    return this.state.invalid ? <NotFoundPage /> : this.props.children
  }
}
