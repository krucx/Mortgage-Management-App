import { useState, type ReactNode } from 'react'
import { sender } from '../messaging'

const INLINE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/

/** *bold*, _italic_ and ~struck~ text, as WhatsApp shows them. */
function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (i % 2 === 0) return part
    const inner = part.slice(1, -1)
    if (part.startsWith('*')) return <strong key={i}>{inner}</strong>
    if (part.startsWith('_')) return <em key={i}>{inner}</em>
    return <s key={i}>{inner}</s>
  })
}

/** A message as the Customer will see it in WhatsApp, ```monospace``` cards included. */
export function WhatsAppPreview({ text }: { text: string }) {
  return (
    <div className="whatsapp" aria-label="How the message will look in WhatsApp">
      <div className="bubble">
        {text.split('```').map((part, i) =>
          i % 2 ? (
            <pre key={i}>{part.replace(/^\n/, '').replace(/\n$/, '')}</pre>
          ) : (
            // A block ends its own line, so the line break after it is not shown twice.
            <span key={i}>{inline(i > 0 ? part.replace(/^\n/, '') : part)}</span>
          ),
        )}
      </div>
    </div>
  )
}

/** WhatsApp's chat bubble, for buttons too small for the word "WhatsApp"; give the
 *  button an aria-label saying what it does. */
export function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M4 20l1.4-4A8 8 0 1 1 8.4 19L4 20Z" />
    </svg>
  )
}

/** Opens WhatsApp with `text` ready for the Lender to send, choosing the number if
 *  the Customer has two. */
export function SendOnWhatsApp({
  phones,
  text,
  onSent,
  disabled = false,
}: {
  phones: string[]
  text: string
  onSent?: () => void
  disabled?: boolean
}) {
  const [phone, setPhone] = useState(phones[0])
  return (
    <div className="row">
      {phones.length > 1 && (
        <select aria-label="Send to" value={phone} onChange={(event) => setPhone(event.target.value)}>
          {phones.map((number) => (
            <option key={number}>{number}</option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="whatsapp-send"
        disabled={disabled || !phone}
        onClick={() => {
          sender.send(phone, text)
          onSent?.()
        }}
      >
        Send on WhatsApp
      </button>
    </div>
  )
}
