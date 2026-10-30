# Changelog

Every release of Mortgage Management, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Domain terms are as defined in
[GLOSSARY.md](GLOSSARY.md).

## [2.0.0] - 2026-10-30

A Payment of a Mortgage's whole Redemption Amount Redeems it, with one Receipt for
everything handed over; and on Windows the app updates itself safely, from a banner in the
app, and starts from its installed icon. **Updates the database** (Payments that Redeem
keep their parts together): the app takes a Backup marked `-before-update` first, and
1.5.1 does not start on the updated database.

### Added

- **Redeeming with a Payment:** when an Allocation on New Payment is its Mortgage's whole
  Redemption Amount, the app asks "Redeem and hand back the jewellery?" and Redeems it on
  the Payment date, with that Allocation as its Final Payment, alongside any other parts,
  all or none. One Receipt covers everything handed over and marks the Mortgages it
  Redeemed; saving opens it.
- **New Payment shows each Mortgage's Redemption Amount** on the Payment date beside its
  Outstanding (with the reason when there is none), and **Pay the full Redemption Amount**
  fills each Allocation with it, or says why it can't.
- **"Paid up to [last Accrual Date]: Redeem now?"** after a Payment shows the Final Payment
  and its Part-Month Rule; the Ready to Redeem popup's Final Payment joins its Payment's
  Receipt.
- **Update banner:** when a newer release is out, the app says so with what's new. On
  Windows, **Install now** updates it and the app reloads by itself on the new version;
  **Later** hides it until the next release.
- **Start from the app's icon (Windows):** when the app isn't running, the installed app
  offers **Start Mortgage Management**, and loads once it answers.
- **Each release on GitHub** comes with a ready-built download, its notes this changelog.

### Changed

- **Paying a whole Redemption Amount Redeems:** it is no longer accepted as an ordinary
  Allocation ("Redeem it with this Payment instead"), so paying off on an Accrual Date
  Redeems the Mortgage.
- **Safe updates (Windows):** each version is installed beside the one running, in
  `MortgageManagement\versions`, and switched to only once it starts (`app` now points at
  the version that runs). If anything fails, Setup says "Update failed; still on x.y.z"
  and the version you had keeps running; if the new version had already updated the
  database, it names the Backup to restore. The version before is kept.
- **Smaller updates (Windows):** Setup downloads nothing when you have the newest release,
  and without Docker installs the release ready-built: no Node.js or npm is needed, and
  the backend serves the app's screens itself.
- **Setup without internet (Windows)** starts the version you have instead of stopping.
- **Equal shares on New Payment** fill each Mortgage up to its Redemption Amount, then
  share the rest.
- **"Can't redeem"** in the To redeem on columns is a compact red marker, its reason in a
  tooltip.

### Fixed

- After a Payment, the Redeem offer quoted the whole Redemption Amount it had just paid
  instead of what was left.
- A Mortgage paid in two parts of one Payment took two Receipt lines, with the Total owed
  wrong.
- Changing a value in `.env` on Windows dropped that line's Windows line ending.

### Upgrading

On Windows, download **Setup.bat** afresh from the
[install guide](https://krucx.github.io/Mortgage-Management-App/install.html) and run it:
the copy in `app\windows` from 1.5.1 updates in place the old way (it still works, and the
next update is the safe one). From 2.0.0 on, use the banner's **Install now**. Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

## [1.5.1] - 2026-10-28

Choose a separate folder for the database and photos during Windows setup. No database
changes: updating keeps all data and Backups.

### Changed

- **Windows setup:** choose the folder for the database and photos on first install.
  The choice is saved in `DATA_DIR` and reused by Docker and local runs. Existing
  installations keep their selected folder when updated.

## [1.5.0] - 2026-10-21

Close several Mortgages as one change, all or none, with a Preview of every Closure first;
and a change the app would refuse is now refused before you confirm it. No database
changes: updating keeps all data and Backups.

### Added

- **Closing several Mortgages at once, all or none:** Forfeiting or Waiving off the
  Mortgages chosen on Redeem / Forfeit, and Redeeming the ones a Payment left Ready to
  Redeem, is one change. If any one of them can't be closed, none is, and the reason names
  that Mortgage. Each shows a Preview of every Closure before you confirm.
- **Reference on bulk Waive-offs:** the Waive-off panel on Redeem / Forfeit takes a
  reference for the final Payments, kept on each.
- **"Fully paid: Redeem now?"** after a Payment shows the Preview of the Redemptions before
  Redeeming them.

### Changed

- **Refused before you confirm:** a Customer on someone else's Primary Number (or, when
  editing, a Referrer's) can't be saved, and deleting a Customer who has Mortgages says why
  without asking first. Before, both were refused only after Confirm.
- **Mortgage Name:** Create Mortgage waits until the suggested Mortgage Name matches the
  description and start date as typed, so a Mortgage is never saved under the name for an
  earlier description. If no name can be suggested, the form says so; type one.
- Whether a Mortgage can be Waived off, or closed on a future date, is decided by the
  server alone, and its reason shows in the Preview. A future date is still quoted.
- A closed Mortgage's figures (final Payment, Waived Amount, profit or loss) are worked out
  once and read the same on its page, the Dashboard and Receipts; nothing shown changes.

### Fixed

- The Referrer search, and the Customers, Mortgages and Payments filters, have names for
  screen readers.

### Upgrading

On Windows, run `Setup.bat` (see README). Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

## [1.4.0] - 2026-10-20

Remove the app from Windows by double-click, keeping the latest Backup, and install it
with the new guide on GitHub Pages. No database changes: updating keeps all data and
Backups.

### Added

- **Windows uninstall by double-click:** `windows/Uninstall.bat` removes the app from the
  PC. It stops the app and moves the latest Backup into Documents; only then does it
  delete the Docker images, the Desktop shortcut, the data and the install folder. A
  Backup folder chosen outside the install folder (Google Drive, OneDrive) is left as it
  is (see README).
- **Install guide:** <https://krucx.github.io/Mortgage-Management-App/install.html> has
  `Setup.bat` to download, and every step for the Lender's own computer: install, start,
  update, Backups and restore, remove, and what to do when something goes wrong.

### Changed

- When the app's server can't be reached, the app now says the server isn't running,
  rather than asking to check Docker (which the app may not use).

### Upgrading

On Windows, run `Setup.bat` (see README); it also brings `Uninstall.bat`. Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

## [1.3.0] - 2026-10-20

Set up on Windows by double-click, with or without Docker, and run the published images
from Docker Hub. No database changes: updating keeps all data and Backups.

### Added

- **Windows setup by double-click:** `windows/Setup.bat` gets the latest release (with git
  when it is installed, else as a download), writes the `.env` and puts a **Mortgage
  Management** shortcut on the Desktop. With Docker Desktop installed the app runs in
  Docker; without it, setup installs Node.js and uv and the app runs directly on the PC.
  Running Setup again updates the app and keeps the `.env`, data and Backups (see README).
- **Backups without a zip program:** where there is none (Windows without Docker), the app
  writes plain zips itself. A Backup password still needs the zip program: without it, the
  Backup fails and says so, rather than writing an unprotected zip.

### Changed

- **Running the app pulls it from Docker Hub:** `docker compose up -d` runs the
  published images (`krucx11/mortgage-management-app`), the latest release unless
  `APP_VERSION` in `.env` names one. Nothing is built on the Lender's laptop.
- **Updating** is `git pull`, `docker compose pull`, `docker compose up -d`.
- **Development:** `docker-compose.dev.yml` builds both images from the folder instead,
  under their own `:dev` names, so they never replace the published ones (see README).

### Upgrading

On Windows, run `Setup.bat` (see README). Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

## [1.2.0] - 2026-10-20

A third way to close a Mortgage: Waive off a small balance. No database changes:
updating keeps all data and Backups.

### Added

- **Waive off**, between Redeem and Forfeit: the Customer pays what they can (or
  nothing) as the final Payment, the Lender lets off the rest of the Redemption
  Amount, and the jewellery goes back. The Mortgage is then **Waived** (see
  GLOSSARY.md). Paying the whole Redemption Amount is refused: that is a Redemption.
  - **On a Mortgage:** **Close this Mortgage** offers **Redeem… · Waive off… ·
    Forfeit…**. Waive off shows what is let off as the amount received is typed, a
    Preview, and a confirmation. Afterwards, the Mortgage shows the final Payment (with
    its Receipt), what was waived off and the reason.
  - **On Redeem / Forfeit:** the section is now **Forfeit or Waive off**. Tick Active
    Mortgages, then choose **Forfeit** or **Waive off** for the chosen. Waive off takes
    what each brought in, one Payment method and one reason for all.
  - **Dashboard:** **Closed in [month]** has a **Waived off** tile between Redeemed and
    Forfeited, with the total let off. It opens those Mortgages.
  - **Mortgages page:** a **Waived off** status filter. Waived Mortgages sort between
    Redeemed and Forfeited.
  - **Reopen** undoes a Waiver like any Closure, Voiding its final Payment.
- **Mortgages page:** the search also finds a Customer's Mortgages by their Primary
  Number: the whole number however it is typed (spaces, dashes, +91 or a leading 0),
  or a run of 3 or more of its digits. Digits that are part of a Mortgage Name, such
  as its year, still find it too.
- **Install as an app:** the app is a Progressive Web App. Chrome, Edge and Safari can
  install it with its own icon and window (see README). It opens even when Docker is
  stopped, and then says plainly that the server can't be reached, instead of "Failed to
  fetch". Figures are never cached on the device: they always come from the server.
- **Published images:** each release is pushed to Docker Hub as
  `krucx11/mortgage-management-app`, tagged `backend-<version>` and `ui-<version>`.
  `backend-latest` and `ui-latest` move to it when it is the highest version so far. Built for Intel and Apple-silicon machines
  after the tests pass.
- **Version in the top bar:** the app's version shows as a small superscript beside
  "Mortgage Management" (e.g. v1.2.0), so it is plain which release is running.

### Changed

- **Receipts:** a Waiver's final Payment shows nothing still owed, since the rest was
  let off with it.

### Upgrading

```sh
git pull
docker compose up -d --build
```

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
