import { useState } from 'react'
import type { Mortgage } from '../../api'
import { ChangePreview } from '../../components/BeforeAfter'
import { ClosureSummary, CloseMortgage } from './CloseMortgage'
import { ReasonDialog } from '../../components/ReasonDialog'
import { changes, previews } from '../../requests'
import { useMortgageChange } from '../../serverState'

/** An Active Mortgage's ways to close it; a Closed one's Closure, and reopening it. */
export function MortgageClosure({
  mortgage,
  onChange,
}: {
  mortgage: Mortgage
  onChange: (updated: Mortgage) => void
}) {
  const changeMortgage = useMortgageChange()
  const [reopening, setReopening] = useState(false)

  if (mortgage.status === 'active') {
    return (
      <>
        <h3>Close this Mortgage</h3>
        <CloseMortgage mortgage={mortgage} onClosed={onChange} />
      </>
    )
  }
  return (
    <>
      <h3>Closure</h3>
      <div className="stack">
        <ClosureSummary mortgage={mortgage} />
        <div>
          <button type="button" className="secondary small" onClick={() => setReopening(true)}>
            Reopen…
          </button>
        </div>
        {reopening && (
          <ReasonDialog
            title={`Reopen ${mortgage.name}?`}
            wide
            body={
              <>
                <p>
                  It becomes Active again as if it had never been closed: interest is charged for
                  the whole time, up to today.
                  {mortgage.closure?.payment_id &&
                    ' Its final Payment is voided, so it is no longer counted.'}
                </p>
                <ChangePreview request={previews.reopen(mortgage.id)} />
              </>
            }
            confirmLabel="Reopen"
            onConfirm={async (reason) => {
              await changeMortgage((client) => changes.reopen(client, mortgage.id, reason))
            }}
            onClose={() => setReopening(false)}
          />
        )}
      </div>
    </>
  )
}
