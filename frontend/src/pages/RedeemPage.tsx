import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { CloseMortgage } from './mortgage/CloseMortgage'
import { NotLoaded } from '../components/NotLoaded'
import { PersonLink } from '../components/PersonLink'
import { mortgageQuery } from '../requests'
import { useServerState } from '../serverState'
import { useNumericId } from '../useNumericId'

/** Redeem one Mortgage on its own page; Cancel goes back to wherever the Lender came from. */
export function RedeemPage() {
  const id = useNumericId()
  const navigate = useNavigate()
  const { client } = useServerState()
  const { data: mortgage, error } = useQuery(mortgageQuery(client, id))

  if (!mortgage) return <NotLoaded error={error} missing={`Mortgage ${id}`} />

  return (
    <section className="card wide">
      <div className="row spread">
        <h2>Redeem {mortgage.name}</h2>
        <span>
          Customer: <PersonLink person={mortgage.customer} />
        </span>
      </div>
      {mortgage.status !== 'active' ? (
        <p className="hint">This Mortgage is already {mortgage.status}.</p>
      ) : (
        <CloseMortgage
          mortgage={mortgage}
          initialAction="redeem"
          onCancel={() => navigate(-1)}
          onClosed={() => navigate(-1)}
        />
      )}
    </section>
  )
}
