import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import type { Mortgage } from '../api'
import { CallNotes } from '../components/CallNotes'
import { History } from '../components/History'
import { NotLoaded } from '../components/NotLoaded'
import { mortgageHistoryQuery, mortgageQuery } from '../requests'
import { keys, useServerState } from '../serverState'
import { AdvancePanel } from './mortgage/AdvancePanel'
import { CollateralPanel } from './mortgage/CollateralPanel'
import { Ledger } from './mortgage/Ledger'
import { MortgageClosure } from './mortgage/MortgageClosure'
import { MortgageOverview } from './mortgage/MortgageOverview'
import { MortgagePhotos } from './mortgage/MortgagePhotos'
import { ProjectionPanel } from './mortgage/ProjectionPanel'
import { TermsPanel } from './mortgage/TermsPanel'

/** One Mortgage: what it owes, its Terms, Collateral, Call Notes, photos, Closure,
 *  Ledger, Projection and History. Each section is its own component in ./mortgage. */
export function MortgagePage() {
  const id = Number(useParams().id)
  const { client, queryClient } = useServerState()
  const loaded = useQuery(mortgageQuery(client, id))
  const mortgage = loaded.data
  // A change that returns the Mortgage (Terms, Advances, Collateral Value, Closure) is in
  // its History too.
  const setMortgage = (changed: Mortgage) => {
    queryClient.setQueryData(keys.mortgage(id), changed)
    void queryClient.invalidateQueries({ queryKey: keys.mortgageHistory(id) })
  }

  if (!mortgage) {
    return <NotLoaded error={loaded.error} missing={`Mortgage ${id}`} />
  }
  const active = mortgage.status === 'active'

  return (
    <section className="card wide">
      <MortgageOverview mortgage={mortgage} />

      <h3>Terms</h3>
      <TermsPanel mortgage={mortgage} onChange={setMortgage} />

      {mortgage.advance_instalments.length > 0 && (
        <>
          <h3>Advances</h3>
          <AdvancePanel mortgage={mortgage} onChange={setMortgage} />
        </>
      )}

      <h3>Collateral Value</h3>
      <CollateralPanel mortgage={mortgage} onChange={setMortgage} />

      <h3>Call Notes</h3>
      <CallNotes mortgageId={mortgage.id} mortgageName={mortgage.name} />

      <h3>Photos</h3>
      <MortgagePhotos mortgage={mortgage} />

      <MortgageClosure mortgage={mortgage} onChange={setMortgage} />

      <h3>Ledger</h3>
      <Ledger mortgage={mortgage} />

      {active && (
        <>
          <h3>Projection</h3>
          <ProjectionPanel mortgage={mortgage} />
        </>
      )}

      <h3>History</h3>
      <History
        query={(page) => mortgageHistoryQuery(client, id, page)}
        title={`History of ${mortgage.name}`}
      />
    </section>
  )
}
