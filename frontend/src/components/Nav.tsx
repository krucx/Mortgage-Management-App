import { useQuery } from '@tanstack/react-query'
import { NavLink } from 'react-router'
import { dormantCountQuery } from '../requests'
import { useServerState } from '../serverState'

/** The app's pages; a red dot on Closures while any Mortgage is Dormant (ADR 0012). */
export function Nav() {
  const { client } = useServerState()
  // Asked for again whenever a change to what Mortgages owe makes it stale; no dot
  // while it can't be had.
  const dormant = useQuery(dormantCountQuery(client)).data ?? 0
  return (
    <nav>
      <NavLink to="/" end>
        Dashboard
      </NavLink>
      <NavLink to="/payments">Payments</NavLink>
      <NavLink to="/customers">Customers</NavLink>
      <NavLink to="/mortgages">Mortgages</NavLink>
      <NavLink to="/calculator">Calculator</NavLink>
      <NavLink to="/call-list">Call List</NavLink>
      <NavLink to="/notices">Notices</NavLink>
      <NavLink
        to="/closures"
        title={dormant ? `${dormant} Dormant: owing nothing, to Redeem` : undefined}
      >
        Closures
        {dormant > 0 && <span className="dot" aria-label={`${dormant} Dormant, to Redeem`} />}
      </NavLink>
      <NavLink to="/settings">Settings</NavLink>
    </nav>
  )
}
