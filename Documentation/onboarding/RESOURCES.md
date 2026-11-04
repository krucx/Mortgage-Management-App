# Onboarding Resources

## In this repo

- [GLOSSARY.md](../../GLOSSARY.md)
  The canonical domain language, with the words to avoid. Use for: every term a lesson uses, word for word.
- [The Gold Chain Story](../../docs/story.html) (`docs/story.html`)
  A year of the sample book told through the app's screenshots; every figure is the app's own. Use for: chapter 001's Go-deeper reading and checking hand-worked figures. A resource, not taught.
- [The sample book](../../docs/sample-book/README.md) (`docs/sample-book/book.py`, `serve.py`)
  Builds and serves the course's cast through the app's own API, clock held at 19 Oct 2026. Use for: every run-through from chapter 002 on.
- [ADR 0001: The Ledger is derived, not stored](../adr/0001-ledger-is-derived-not-stored.md)
  Why nothing owed is stored. Use for: 001.05, the Ledger and Replay chapters.
- [ADR 0002: WhatsApp messages are click-to-send](../adr/0002-whatsapp-click-to-send.md)
  Why the Lender presses Send. Use for: 001.03, Receipts and Follow-up.
- [ADR 0003: Backups go to a cloud-synced folder](../adr/0003-backup-to-synced-folder.md)
  Where Backups go and when. Use for: 001.05, Releases and Backups.
- [ADR 0006: Interest on start-of-month Principal](../adr/0006-interest-on-start-of-month-principal.md)
  Why paying Principal mid-month lowers interest only from the next month. Use for: 001.02, the Ledger engine.
- [ADR 0011: Outstanding includes the Interest to Date](../adr/0011-outstanding-includes-interest-to-date.md)
  Why Outstanding is exactly what would Redeem a Mortgage today. Use for: 001.02, 001.04, Replay and Closures.
- [ADR 0012: Dormant Mortgages are flagged, not Redeemed](../adr/0012-dormant-mortgages-are-flagged-not-redeemed.md)
  Why an Active Mortgage owing nothing waits for the Lender. Use for: 001.04, Replay and Closures.
- [CHANGELOG.md](../../CHANGELOG.md)
  What changed in each release, in the Lender's words. Use for: dating a rule or a screen.

## External

- [Indian numbering system (Wikipedia)](https://en.wikipedia.org/wiki/Indian_numbering_system)
  Lakh and crore, and why ₹1,00,000 is grouped that way. Use for: 001.01.

## Where to get help

- The issue tracker: GitHub Issues on krucx/Mortgage-Management-App (see `Documentation/agents/issue-tracker.md`). Use for: reporting something in the course or the code that looks wrong.
- An agent in this repo. Use for: "explain this term, screen or rule to me".
- The owner. Use for: questions the documents don't answer.

## Gaps

- No ADR explains the three Interest Modes or the Part-Month Rules; the glossary is the only source. Chapter 004 teaches them from `ledger.py`.
- No ADR covers the Cash Limit; `payments/cash_limit.py` and the glossary are the sources.
