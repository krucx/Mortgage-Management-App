# WhatsApp messages are click-to-send, not automated

The spec asked for receipts and notices sent automatically by driving WhatsApp Web through Chromium. We instead open a `wa.me` link with the message prefilled and the Lender presses Send. Browser automation of WhatsApp Web breaks on UI changes, needs a captive logged-in session, and violates WhatsApp's terms — risking a ban on the Lender's number. Sending sits behind one small interface so the WhatsApp Business Cloud API can replace it later if true automation is needed.
