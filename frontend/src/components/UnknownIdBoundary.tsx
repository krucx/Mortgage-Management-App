import { Component, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { InvalidRouteIdError } from '../useNumericId'
import { NotFoundPage } from '../pages/NotFoundPage'

/** Shows Page not found for an address whose id isn't a valid number; resets on navigation.
 *  A page that rewrites its own address as it is used (the Calculator) is not remounted. */
export function UnknownIdBoundary({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation()
  return <Boundary address={pathname + search}>{children}</Boundary>
}

class Boundary extends Component<
  { children: ReactNode; address: string },
  { invalid: boolean; address: string }
> {
  state = { invalid: false, address: this.props.address }

  static getDerivedStateFromError(error: unknown) {
    if (error instanceof InvalidRouteIdError) return { invalid: true }
    throw error
  }

  static getDerivedStateFromProps({ address }: { address: string }, state: { address: string }) {
    return address === state.address ? null : { invalid: false, address }
  }

  render() {
    return this.state.invalid ? <NotFoundPage /> : this.props.children
  }
}
