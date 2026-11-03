# Ledger Engine Resources

## Knowledge

- [ADR 0001: The Ledger is derived, not stored](Documentation/adr/0001-ledger-is-derived-not-stored.md)
  The decision itself, and why stored ledger rows were rejected. Use for: the "why replay" question.
- [ADR 0006: Interest on start-of-month Principal](Documentation/adr/0006-interest-on-start-of-month-principal.md) and [ADR 0011: Outstanding includes Interest to Date](Documentation/adr/0011-outstanding-includes-interest-to-date.md)
  The two rules that shape every interest line and the Redemption cap. Use for: same-day ordering, Interest to Date, Redemptions.
- [`backend/src/mortgage_backend/lending/ledger.py`](backend/src/mortgage_backend/lending/ledger.py)
  The pure engine (`compute_ledger`, `_Run`). Use for: the exact rules; its docstring is the spec.
- [`backend/src/mortgage_backend/lending/replay.py`](backend/src/mortgage_backend/lending/replay.py)
  Loads stored facts and feeds the engine; Voided Payments filtered here. Use for: what goes into a replay.
- [`backend/src/mortgage_backend/lending/changes.py`](backend/src/mortgage_backend/lending/changes.py)
  Write, then `check_replays`, inside one transaction. Use for: how bad changes are refused.
- [GLOSSARY.md](GLOSSARY.md)
  The project's vocabulary. Every lesson uses its terms.
- [Martin Fowler, "Event Sourcing"](https://martinfowler.com/eaaDev/EventSourcing.html)
  The general pattern: keep the log of facts, rebuild state from it. Use for: the outside-world name for what ADR 0001 does.
- [Martin Fowler, "Retroactive Event"](https://martinfowler.com/eaaDev/RetroactiveEvent.html)
  How event-sourced systems deal with facts that arrive late: find the branch point and replay. Use for: back-dated Payments.

## Wisdom (Communities)

- Not yet chosen. The project's own architecture-review passes (`Documentation/architecture-reviews/`) are the nearest thing to outside critique.

## Gaps

- A good practitioner source on loan-servicing payment waterfalls (interest-first allocation) in Indian gold-loan lending.
