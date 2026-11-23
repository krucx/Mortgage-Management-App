import { useState } from 'react'
import { ClosingBar } from './closures/ClosingBar'
import { DormantMortgages } from './closures/DormantMortgages'
import { ForfeitableMortgages } from './closures/ForfeitableMortgages'
import { useDormantList, useForfeitableList } from './closures/useClosureLists'

/**
 * Closures in one place: Dormant Mortgages, owing nothing, to be Redeemed (ADR 0012),
 * and Active Mortgages the Lender may choose to Forfeit or Waive off, together.
 */
export function ClosuresPage() {
  // Both lists are sorted and paged on the server.
  const dormant = useDormantList()
  const forfeitable = useForfeitableList()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const error = forfeitable.error ?? dormant.error

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  // Only Mortgages still owing something.
  const chosen = (forfeitable.listed?.items ?? [])
    .filter((m) => selected.has(m.id))
    .map((m) => ({ id: m.id, name: m.name }))

  return (
    <section className="card wide">
      <h2>Closures</h2>
      {error && <p className="status error">{error}</p>}
      <DormantMortgages {...dormant} />
      <ForfeitableMortgages {...forfeitable} selected={selected} onToggle={toggle} />
      <ClosingBar chosen={chosen} onDone={() => setSelected(new Set())} />
    </section>
  )
}
