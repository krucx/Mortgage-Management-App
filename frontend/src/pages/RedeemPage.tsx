import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, type Mortgage } from '../api'
import { CloseMortgage } from '../components/CloseMortgage'
import { PersonLink } from '../components/PersonLink'

/** Redeem one Mortgage on its own page; Cancel goes back to wherever the Lender came from. */
export function RedeemPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const [mortgage, setMortgage] = useState<Mortgage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getMortgage(id)
      .then(setMortgage)
      .catch((err: Error) => setError(err.message))
  }, [id])

  if (!mortgage) return error ? <p className="status error">{error}</p> : <p>Loading…</p>

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
