import { useState } from 'react'
import type { MortgageRow } from '../../api'
import { owesSomething } from './allocation'

/** The ticked Mortgages: at first the preselected one (or all owing something); when the
 *  list changes (another date), those still in it stay ticked. */
export function useSelection(mortgages: MortgageRow[] | null, preselected?: number) {
  const [selection, setSelection] = useState<{ of: MortgageRow[] | null; ids: Set<number> }>({
    of: null,
    ids: new Set(),
  })
  if (mortgages && selection.of !== mortgages) {
    // (Set while rendering, as React allows for a component's own state.)
    const ids = mortgages.filter(owesSomething).map((m) => m.id)
    setSelection({
      of: mortgages,
      ids: selection.of
        ? new Set(ids.filter((id) => selection.ids.has(id)))
        : new Set(preselected && ids.includes(preselected) ? [preselected] : ids),
    })
  }
  const setSelected = (ids: Set<number>) => setSelection({ of: mortgages, ids })
  return [selection.ids, setSelected] as const
}
