# Changelog

Every release of Mortgage Management, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Domain terms are as defined in
[GLOSSARY.md](GLOSSARY.md).

## [1.1.2] - 2026-10-19

WhatsApp messages keep their emoji. No database changes: updating keeps all data and
Backups.

### Fixed

- Emoji in Receipts and Notices (such as 🔔, 🙏 and ✅) arrived in WhatsApp as "�",
  although the preview showed them correctly. Messages and Call List chats now open
  WhatsApp's own send link (`api.whatsapp.com/send`) directly, instead of the `wa.me`
  short link, whose redirect garbled them.

### Upgrading

```sh
git pull
docker compose up -d --build
```

## [1.1.1] - 2026-10-19

A cleaner Call List. No database changes: updating keeps all data and Backups.

### Changed

- **Call List:** one table with a row per Mortgage, grouped by Customer. The Customer
  appears once beside all their rows, with:
  - the number of their Mortgages on the list, linking to them on the Mortgages page;
  - their total Outstanding;
  - each number's Call and WhatsApp buttons on one line.

  A heavier line separates one Customer from the next.
- **Call List reasons** are coloured oval status markers with the figure inside
  ("15 mo", "104.5%", "Today"), and the legend at the top uses the same markers. The full
  wording shows on hover and is read out by screen readers.
- **Notices:** a Notice waiting to send has a compact WhatsApp button with a short "Send"
  in its row, beside Skip. It still opens the message to review first.

### Added

- **Mortgages page:** `?customer=` shows one Customer's Mortgages only, says whose they
  are, and has a **Show every Customer** button. The Call List's count links here.

### Upgrading

```sh
git pull
docker compose up -d --build
```

## [1.1.0] - 2026-10-19

The same features as 1.0.0, kept in step across every page, with a light/dark switch and
a demo site for stakeholders. No database changes: updating keeps all data and Backups.

### Added

- A light/dark switch at the right of the top bar. The app follows the browser's theme
  until the Lender presses it; the choice is then remembered on the laptop, and pressing
  it back to the browser's theme follows the browser again.
- A demo site on GitHub Pages (`docs/`), with its own light/dark switch:
  - **Mortgage Book Walkthrough**, a presenter's guide to every page: where to click, what
    to say, and the rules worth pointing out.
  - **The Gold Chain Story**, the app told as one Customer's year, with live screenshots
    to step through and small models of Interest Modes, splitting a Payment, the Call
    List rule and a Notice's life. It uses invented sample data only.
- The API reports the app's version (`1.1.0`) in its schema.

### Changed

- Pages open at once with what was last shown and refresh it in the background. The
  Dashboard dims cached figures until they are refreshed.
- After a save, the page for what changed shows it straight away, and everything else
  that shows it updates too: the Ready to Redeem dot, the Dashboard, the Call List, the
  Notices, Receipts and History. For example:
  - renaming a Customer reaches their Mortgages, Payments and Receipts;
  - marking a Mortgage called updates the Dashboard's Call List count;
  - new message settings reword Receipts already shown.
- Change Terms, Edit Mortgage, New Payment and Redeem/Forfeit share one way of saving.
  Save stays off while the Preview says the backend would refuse the change, every save
  asks to confirm, and a refused save shows the backend's reason and can be tried again.
- A Preview keeps its last answer on screen, dimmed, while the next one loads.
- A refusal from the backend shows at once instead of being asked for again; a failure
  to reach it is retried once.

### Fixed

- After a Void, the Voided Payment's Receipt is no longer asked for (it has none); after a
  Redemption or Forfeiture, the closed Mortgage's Projection is no longer asked for.
- After a save, a Preview or Redemption Amount quote of the change just made is no longer
  asked for again (the backend refused it, as the change was already made).

### For developers

- Frontend: one server-state module (TanStack Query over an `openapi-fetch` client typed
  from the backend's OpenAPI schema). Every request is named in `src/requests.ts`; what
  each change makes stale is declared once in `src/serverState.ts`; a lint rule refuses
  `fetch` anywhere else. The hand-written fetch functions and the `ledger-changed` window
  event are gone.
- Frontend tests now include page tests against a fake backend (39 → 57 tests).
- Backend modules are grouped into packages named after the glossary's sections:
  `people`, `lending`, `collateral`, `payments`, `follow_up`, `safekeeping` and
  `platform`. Message settings routes and Call Notes moved to their own modules. Routes,
  the API schema and the generated types are unchanged apart from the version.
- ADR-0007: each change's Preview route stays written out by hand beside its save route.
- Project documentation moved from `docs/` to `Documentation/`; `docs/` now holds only
  the GitHub Pages site.

### Upgrading

```sh
git pull
docker compose up -d --build
```

No database update runs. Taking a Backup first from Settings (**Back up now**) is still
good practice.

## [1.0.0] - 2026-10-18

The first complete release, running on the Lender's own laptop with Docker Compose.

### Added

- **Dashboard:** the whole lending book at a glance: owed on Active Mortgages, interest
  collected, Collateral Value and Loan-to-Value, today's follow-up, Closures this month,
  Payments by month, and the book projected 3, 6 and 12 months ahead. Every tile links
  to the list behind it.
- **Customers and Referrers:** Customers known by their Primary Number (no two people
  share one), with photos, a second number that may be shared, and who referred them: an
  existing Customer or a Standalone Referrer, who becomes a Customer if they borrow.
- **Mortgages:** one per packet of jewellery, with weights, purity, photos and a
  suggested Mortgage Name; Terms (monthly rate, Interest Mode, Part-Month Rule) copied
  from the Default Terms; Term Changes from an Accrual Date on; a Ledger replayed from
  the Terms and Payments, never stored; Collateral Value from the Gold Rates or set by
  hand; Projections with a what-if monthly Payment; Call Notes and History.
- **Previews:** every change that affects money (edits, Term Changes, Payments, Voids,
  Redeem, Forfeit, Reopen, Collateral Value, a new Mortgage) shows its effect before it
  is saved, and every save is confirmed.
- **Payments:** one sum split across a Customer's Mortgages equally, by amount or by
  percentage, paying unpaid interest before Principal; back-dated Payments; Receipts on
  WhatsApp or printed; Voids with a reason, kept on record; the offer to Redeem a
  Mortgage a Payment clears.
- **Follow-up:** Notices queued each morning ahead of Accrual Dates (optionally approved
  first), sent through WhatsApp, or skipped; the daily Call List for Months Unpaid, high
  Loan-to-Value or accruing today, with Call Notes.
- **Redeem / Forfeit:** Redemption Amounts for any date including the part-month charge,
  Mortgages Ready to Redeem, Forfeiture with the profit or loss, and Reopen.
- **Settings:** Default Terms, Gold Rates, Call List thresholds, WhatsApp templates and
  Notice timing, and Backups.
- **Safekeeping:** History of every change, never edited; password-protected Backups
  weekly and before every database update, into a synced folder.

[1.1.2]: https://github.com/krucx/Mortgage-Management-App/compare/1.1.1...1.1.2
[1.1.1]: https://github.com/krucx/Mortgage-Management-App/compare/1.1.0...1.1.1
[1.1.0]: https://github.com/krucx/Mortgage-Management-App/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/krucx/Mortgage-Management-App/releases/tag/1.0.0
