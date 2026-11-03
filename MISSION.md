# Mission: How this app's Ledger works

## Why
I own this Mortgage app (built largely with agents) and want to understand its Ledger engine well enough to reason about any money figure it shows, explain it to a Customer, and judge whether an agent's change to the engine is correct.

## Success looks like
- Explain, without opening the code, why the Ledger is replayed rather than stored, and what that buys for back-dated Payments, Voids and Term Changes.
- Given a Mortgage's facts, hand-trace its Ledger: Accrual Dates, Interest to Date, the order a Payment pays things, Capitalisation.
- Explain what happens on Redeem, Waive, Forfeit and Reopen, including the Final Payment and the Redemption cap.
- Read a diff to `lending/ledger.py` or `lending/replay.py` and say what it changes in the numbers.

## Constraints
- Learn from this repo's own code, ADRs and GLOSSARY.md first; outside sources only for the general pattern.
- Short lessons.

## Out of scope
- Frontend, WhatsApp messaging, backups, deployment.
