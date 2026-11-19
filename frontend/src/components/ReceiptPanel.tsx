import { useState } from 'react'
import { Link } from 'react-router'
import type { Receipt } from '../api'
import { SendOnWhatsApp, WhatsAppPreview } from './WhatsApp'

/** A Receipt for the Customer: sent on WhatsApp, or printed from `printPath`. Reopen it
 *  any time. */
export function ReceiptPanel({ receipt, printPath }: { receipt: Receipt; printPath: string }) {
  const [sent, setSent] = useState(false)
  return (
    <div className="receipt-panel">
      <WhatsAppPreview text={receipt.text} />
      <div className="stack">
        <SendOnWhatsApp phones={receipt.phones} text={receipt.text} onSent={() => setSent(true)} />
        {sent && <p className="hint">WhatsApp opened: press Send there.</p>}
        <Link to={printPath}>Print or save as PDF</Link>
        {!receipt.advance_due_on && (
          <p className="hint">The wording comes from the Receipt template in Settings.</p>
        )}
      </div>
    </div>
  )
}
