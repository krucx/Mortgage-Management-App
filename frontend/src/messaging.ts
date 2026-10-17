// Sending a message to a Customer. Today it is click-to-send WhatsApp (ADR 0002): a
// wa.me link opens with the message prefilled and the Lender presses Send. Everything
// else goes through `sender`, so the WhatsApp Business API can replace it later.

export interface MessageSender {
  /** Send `text` to a 10-digit Indian mobile number. */
  send(phone: string, text: string): void
}

/** Opens WhatsApp (app or web) with the chat and message ready to send. */
const clickToSend: MessageSender = {
  send(phone, text) {
    window.open(whatsAppLink(phone, text), '_blank', 'noopener')
  },
}

export const sender: MessageSender = clickToSend

function whatsAppLink(phone: string, text: string): string {
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`
}
