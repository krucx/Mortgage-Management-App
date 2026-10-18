// Sending a message to a Customer. Today it is click-to-send WhatsApp (ADR 0002): a
// WhatsApp link opens with the message prefilled and the Lender presses Send. Everything
// else goes through `sender`, so the WhatsApp Business API can replace it later.

export interface MessageSender {
  /** Send `text` to a 10-digit Indian mobile number. */
  send(phone: string, text: string): void
  /** Open a conversation with the number, to write in it (e.g. from the Call List). */
  chat(phone: string): void
}

/** Opens WhatsApp (app or web) with the chat, and the message ready to send. */
const clickToSend: MessageSender = {
  send(phone, text) {
    window.open(whatsAppLink(phone, text), '_blank', 'noopener')
  },
  chat(phone) {
    window.open(whatsAppLink(phone), '_blank', 'noopener')
  },
}

export const sender: MessageSender = clickToSend

/**
 * WhatsApp's own send link. Not the wa.me short link: its redirect to this one turns
 * emoji (🙏, 🔔, even ✅) into "�" on the way, though the preview showed them fine.
 */
function whatsAppLink(phone: string, text?: string): string {
  const query = new URLSearchParams({ phone: `91${phone}` })
  if (text !== undefined) query.set('text', text)
  return `https://api.whatsapp.com/send/?${query}`
}
