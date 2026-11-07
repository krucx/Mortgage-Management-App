# Changelog

Every release of Mortgage Management, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Domain terms are as defined in
[Documentation/GLOSSARY.md](Documentation/GLOSSARY.md).

## Unreleased

### Changed

- **Reminders:** renamed the follow-up feature across the app, API, database and
  documentation. Migration 0017 preserves existing Reminders, Mortgage links and
  message settings while renaming their database names.
- **Sendable Reminders:** unsent Reminders are removed when no Active Mortgage
  accrues on their date. Remaining eligible Mortgages stay on the Reminder; sent and
  skipped Reminders keep their recorded message and Mortgage details.

## [3.4.3] - 2026-11-07

Edit Mortgage can correct the starting Terms and shows how existing Payments replay.
**No database changes:** updating keeps all data and Backups, and 3.4.2 still starts
on the same database.

### Changed

- **Starting Terms:** onboarding and user-facing documentation distinguish correcting
  a Mortgage's starting rate, Interest Mode and Part-Month Rule from adding a dated
  Term Change. The Edit Mortgage Preview shows Outstanding before and after and explains
  why replay refuses a correction that makes a Payment larger than what was owed on its
  date.

## [3.4.2] - 2026-11-07

Discounts can reduce what a Customer owes alongside a Payment, including when that
Payment Redeems a Mortgage. **Database change:** migration 0016 adds a Discount amount
to each Mortgage Allocation; existing records default to zero.

### Added

- **Discounts:** record a non-cash reduction separately from cash for each Mortgage in
  a Payment. Cash is applied first, then Discount; each reduces unpaid interest,
  Interest to Date, and Principal in that order. The Settings page controls the extra
  confirmation threshold (₹500 by default); the screen asks before capping one at the
  remaining Outstanding. Discounts appear on Receipts but are excluded from cash totals
  and reports. Cash plus Discount can Redeem
  a Mortgage; Reopen reverses both by Voiding the Final Payment.

### Upgrading

Migration 0016 adds `allocation.discount`, with existing Allocations set to zero. The
app backs up the database before migrating. If rolling back after recording Discounts,
restore that pre-update Backup first; version 3.4.1 does not replay Discounts.

## [3.4.1] - 2026-11-06

The Calculator shows what a loan comes to first, without scrolling. **No database
changes:** updating keeps all data and Backups, and 3.4.0 still starts on the same
database.

### Changed

- **Calculator:** what it comes to (the figures and Lend this) is at the top, above the
  inputs, so it shows without scrolling, and always in place: at ₹0 until there is an
  amount, so nothing on the screen moves while it is typed. The graph is folded away to
  start with, empty until there is something to draw; month by month is below the
  inputs. The graph and each group of inputs (Loan and Terms, Planned Payments,
  Jewellery value) fold; Planned Payments starts folded unless a plan was entered.

## [3.4.0] - 2026-11-06

The app ships as one Docker image, and the backend refuses uploads over 20 MB with or
without Docker. **No database changes:** updating keeps all data and Backups, and 3.3.0
still starts on the same database.

### Changed

- **One image:** with Docker the app is one image, `krucx11/mortgage-management-app:<version>`
  (`:latest` for the newest), and one Compose service, `app`, instead of a `backend`
  and an nginx `frontend`. The backend serves the screens itself, as it already did
  without Docker; the address stays <http://localhost:8080>. Logs are now
  `docker compose logs app`. Releases before 3.4.0 keep their `backend-`/`ui-` images
  on Docker Hub, so going back to one still works: on Windows as before, elsewhere
  with that release's own compose file (`git checkout 3.3.0`).
- **Updating and going back with Docker** remove the other version's containers
  (`--remove-orphans`), so the old `frontend` never keeps holding the port.
- **Uninstall with Docker** removes every image of the app, the version before
  included, not only the one running.
- **Uploads over 20 MB** are refused, now also without Docker, where nothing limited
  them before; nothing is stored. The screens say "The photo is too large (over 20 MB)."

### Upgrading

Nothing to do on Windows: use the banner's **Install now**, and Setup switches from the
two old containers to the new one. Elsewhere, add `--remove-orphans`:

```sh
git pull
docker compose pull
docker compose up -d --remove-orphans
```

## [3.3.0] - 2026-11-06

A Calculator, to size up a loan before lending, and whole-rupee gridlines on the
charts. **No database changes:** updating keeps all data and Backups, and 3.2.2 still
starts on the same database.

### Added

- **Calculator** (in the menu, between Mortgages and Call List): a Simulation of a
  loan, an amount, a start date, the day it would close on and its Terms, worked out
  by the same Ledger as a real Mortgage, so a Mortgage lent on those Terms and paid
  the same way owes exactly what it said. It shows the Outstanding on the closing day,
  the total interest earned, the first month's interest and the effective annual rate,
  a graph of the Outstanding over 3 to 36 months, and the Ledger month by month.
  Nothing is saved, and the inputs are kept in the page's address, so a bookmark
  keeps them.
- **Planned Payments in a Simulation:** a monthly amount paid on every Accrual Date,
  and Lump Sums on chosen dates, each paid as a real Payment would be. A **Paid off**
  tile says when the plan clears it (or that it doesn't within 10 years). A Lump Sum
  after the closing day, or after the plan has paid it off, is left out, and one more
  than is owed is refused, each said on its row.
- **Compare other Terms:** a second rate, Interest Mode or Part-Month Rule beside the
  first, with each figure for both, how the second differs, and a line for each on
  the graph.
- **Jewellery value:** a net weight and purity at today's Gold Rate, or a Collateral
  Value typed in, for the Loan-to-Value now and on the closing day.
- **Lend this** opens New Mortgage with the Simulation's amount, start date and
  Terms, ready to choose the Customer. It is off for a start date still to come.

### Changed

- **Chart gridlines in whole rupees:** the Projection and the Dashboard's Payments by
  month label their gridlines in whole rupees, as the Calculator does, never
  "₹80,474.50".
- **Docs:** the Calculator is in the docs, the walkthrough and The Gold Chain Story,
  with new screenshots.

### Upgrading

On Windows, use the banner's **Install now**. Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

## [3.2.2] - 2026-11-05

New Mortgage's Lent Through starts as Cash. **No database changes:** updating keeps all
data and Backups, and 3.2.1 still starts on the same database.

### Changed

- **Lent Through starts as Cash on New Mortgage:** most Principal is handed over in
  cash, so it no longer starts empty with "Choose…". Change it to UPI or bank transfer
  when it was lent that way. Lending in cash at or above the Cash Limit is still
  warned about before the confirmation. Edit Mortgage is unchanged.

### Upgrading

On Windows, use the banner's **Install now**. Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

## [3.2.1] - 2026-11-03

New Payment Redeems what it pays in full without waiting on quotes, the Cash Limit's
warning comes from each change's Preview, photos are kept only when their change is
saved, and Call Notes follow one set of rules. **No database changes:** updating keeps
all data and Backups, and 3.2.0 still starts on the same database.

### Changed

- **New Payment no longer waits on "Checking whether they can be Redeemed…":** the
  Payment Redeems each Mortgage it pays in full by itself, and the Redeem question and
  each Allocation's "Redeems it" come from the Preview. "Can't pay it in full" shows
  its reason straight away.
- **One set of rules for Call Notes:** a Call Note added on its own now follows the
  same rules as one imported from a Call Sheet. It is refused, with the reason shown,
  on a Mortgage that isn't Active (a Dormant one is Active) or with nothing written,
  and Called stays greyed out until a note is typed. The same note twice the same day
  is kept once. An imported Call Note dated before its Mortgage started is now left
  out too. Call Notes already stored are left as they are.
- **The Cash Limit's warning comes from the Preview:** the backend works out the sums
  each change would write in cash (each Payment one sum with its Final Payments, each
  Principal lent in cash), so every page warns alike. Still only a warning.

### Fixed

- **A whole Outstanding that can't Redeem is refused:** paying a Mortgage's whole
  Outstanding on a date it can't be Redeemed (a later Payment) used to be recorded as
  an ordinary Payment, leaving it Dormant. It is now refused with the reason.
- **No photo file is left behind by a change that isn't saved:** a Mortgage photo, a
  Customer photo or an ID Photo whose change was refused or failed used to leave its
  file in the photos folder, and so in every Backup.
- **"Mortgage saved, but a photo failed"** now shows from the first failed photo on
  New Mortgage, instead of the bare error.
- **Retrying a Customer's save no longer uploads their photos again:** each retry used
  to add the Customer photo and ID Photos once more, with a History entry each time.
  Once the Customer is saved, the form keeps their details as saved and sends only the
  photos left.
- **Adding or removing a Mortgage photo updates the Customer's History** at once.
- **"1 day", not "1 days":** closing a Mortgage on the first day of its month now
  says "1 day of the month". New Payment's full-Outstanding note now reads "including
  N days of Interest to Date".

### Upgrading

On Windows, use the banner's **Install now**. Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

## [3.2.0] - 2026-11-03

Customers can have an email, an Aadhaar Number (its last 4 digits only), a PAN and ID
Photos of their cards, with the numbers read from the photos as a suggestion.
**Updates the database** (the new Customer details): the app takes a Backup marked
`-before-update` first, and 3.1.1 does not start on the updated database.

### Added

- **Email, Aadhaar Number and PAN** on the New and Edit Customer forms and the Customer
  page, all optional. Only the last 4 Aadhaar digits are ever sent, kept or shown
  (`XXXX XXXX 1234`): ask for the Customer's masked Aadhaar. A PAN is checked as 5
  letters, 4 digits and a letter, and one already on another Customer is refused,
  naming them.
- **ID Photos:** a photo of the masked Aadhaar front and of the PAN card, added,
  replaced or removed on the form, shown only on the Customer's page and form, and kept
  in History.
- **Numbers read from the photos:** adding an ID Photo reads its number into the empty
  field, marked "Read from the photo: check it". It reads on the laptop itself, never
  sending the photo anywhere, and never overwrites a number already typed.

### Changed

- **Backups hold the ID Photos:** wherever Backups aren't password-protected, Settings
  and the install guide say to keep the Backup folder private.

### Upgrading

Existing Customers have none of the new details until edited.

On Windows, use the banner's **Install now**. Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

## [3.1.1] - 2026-11-02

A Call Sheet with some rows the app can't take no longer fails: it imports the rest
and lists those rows. **No database changes:** updating keeps all data and Backups, and
3.1.0 still starts on the same database.

### Changed

- **Importing a Call Sheet adds the rows it can.** A note naming no Mortgage, an
  unknown or closed one, or without a usable Called on date is left out and listed by
  its Excel row number, Mortgage Name and why; rows without a note are only counted.
  Fix those rows and import the sheet again: notes already added are skipped.
- **The import's Preview is a pop-up** on the Call List page: what it adds, what it
  leaves out, and Add. After saving, **Show them** lists the rows left out. Both close
  on Esc or a click outside, saving nothing; so do the Ledger and History lists.
- **Called on reads more hand-typed dates:** 19/10/2026, 19-10-2026, 19-Oct-2026,
  19 Oct 26 and 19/10/26.

### Upgrading

On Windows, use the banner's **Install now**. Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

## [3.1.0] - 2026-11-02

Dormant Mortgages flagged on the renamed Closures page; Lent Through and a Cash Limit
warning for cash; the Call List as a Call Sheet to export and import; weights in grams.
**Updates the database** (each Mortgage records how it was Lent Through): the app takes
a Backup marked `-before-update` first, and 3.0.0 does not start on the updated
database.

### Added

- **Dormant:** an Active Mortgage that owes nothing, so its jewellery should already have
  gone back; usually a recording slip. Worked out afresh, never stored
  ([ADR 0012](Documentation/adr/0012-dormant-mortgages-are-flagged-not-redeemed.md)).
  Closures lists them with **Redeem…** (no Payment needed), and the menu's Closures
  shows a red dot while any exist. Dormant Mortgages get no Notices and stay off the
  Call List.
- **Lent Through:** how a Mortgage's Principal was handed over (Cash, UPI or bank
  transfer). Required on new Mortgages, shown on the Mortgage page, editable, and kept in
  History; Mortgages made before show "—" until edited.
- **Cash Limit:** a setting, ₹20,000 unless changed. Lending or receiving that much or
  more in cash asks first ("Government of India rules ask for ₹20,000 or more to be lent
  or received by UPI or bank transfer, not cash"), with **Go back** or **Record in cash
  anyway**: on New Payment, a Final Payment when Redeeming or Waiving off, New Mortgage,
  and an edit that makes a Mortgage cash or lends more of it in cash. It only warns;
  cleared, it never asks.
- **Call Sheet:** the Call List exported to Excel or PDF for whoever makes the calls, a
  row per Mortgage with Called on and Call Note to fill in. **Import Call Notes from
  Excel** previews the notes a filled sheet adds, then saves all or none; a closed or
  unknown Mortgage refuses the sheet by name, and importing it twice adds nothing.

### Changed

- **Redeem / Forfeit is now Closures,** in the menu and on the page.
- **Weights are in grams** everywhere ("21.5 grams gross"), not "g".
- **Save waits for its Preview** on New Payment, Edit Mortgage, Change Terms, Redeem and
  Waive off, so the confirmation and the Cash Limit see what would be saved.
- The Ledger's code speaks of the Interest to Date (`interest_to_date_days`), not a
  part-month charge.
- **GitHub Pages:** the walkthrough tours The Gold Chain Story's sample book, every
  figure and address it quotes filled in from the book when the screenshots are retaken;
  the pages and all screenshots are retold for the above.

### Upgrading

Existing Mortgages show Lent Through as "—": set it by editing them when convenient. A
Mortgage that was paid down to nothing before 3.0.0 may now show as Dormant: check it and
Redeem it.

On Windows, use the banner's **Install now**. Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

## [3.0.0] - 2026-11-02

Outstanding is now what would redeem a Mortgage today, today's interest included: one
figure everywhere, from the Mortgage page to New Payment, Closures, Notices and
Receipts. **No database changes:** updating keeps all data and Backups, and 2.0.0 still
starts on the same database.

### Added

- **Interest to Date:** a Mortgage's Outstanding includes the interest for the month
  under way, counted from that month's first day through today under its Part-Month Rule
  ([ADR 0011](Documentation/adr/0011-outstanding-includes-interest-to-date.md)). A
  Full-month Mortgage of ₹3,000 at 3% owes ₹3,090 the day it starts; pro-rata, ₹3,003.
  The Ledger ends with a live Interest to Date step that gives way to the month's
  interest on the next Accrual Date.

### Changed

- **Outstanding is what would redeem it today** on every screen: lists, the Mortgage
  page, Loan-to-Value, the Call List, the Dashboard and Receipts' "Still owed". Months
  Unpaid ignores the Interest to Date.
- **Payments pay unpaid interest, then the Interest to Date, then Principal.** What a
  Payment pays of the Interest to Date counts against the month's interest when it is
  charged. A month starts before its Accrual Date's Payments, so paying the Principal on
  an Accrual Date does not let off the month starting then.
- **New Payment shows one figure per Mortgage,** its Outstanding on the Payment date.
  **Pay the full Outstanding** fills each Allocation with it, or says why it can't. Equal
  shares fill each Mortgage up to its Outstanding, and an Allocation of the whole
  Outstanding asks "Redeem and hand back the jewellery?" as before.
- **Closures speak of the Outstanding on the Closure date:** the Redeem, Waive off and
  Forfeit quotes, Closure details, the Waived Amount (that Outstanding less the final
  Payment) and a Forfeiture's profit or loss (the Recovered Amount less it).
- **Projections and change Previews** show one Outstanding per date, and their chart
  plots it; their unpaid interest includes the Interest to Date, as on the Mortgage page.
- **Notices** quote the month's interest charged on the Accrual Date as "Interest added",
  and the Outstanding that day as "Owed after", the new month's Interest to Date
  included. For Compounded Mortgages, that is the interest before it is capitalised and
  the Outstanding after.
- **A Mortgage that owes nothing** (paid up under the Part-Month Rule "nothing") is left
  out of New Payment's Allocations, with a link to Redeem it.
- **The Part-Month Rule** is described on the terms form as how the Interest to Date is
  charged, not as a charge made on Redemption.

### Removed

- **Redemption Amount:** the separate figure for what Redemption would take, and New
  Payment's "To redeem on" column. The Outstanding is what Redemption takes.
- **Ready to Redeem:** the status, the "Paid up to [last Accrual Date]: Redeem now?" offer
  after a Payment, the Ready to Redeem list on the Closures page and the dot on its tab.
  A Payment of the whole Outstanding Redeems, so nothing waits to be Redeemed.

### Fixed

- Redeeming with a Payment asked about "1 days' Interest to Date".

### Upgrading

**Figures rise on upgrade:** every Active Mortgage's Outstanding now includes today's
interest. A Mortgage that was Ready to Redeem shows its Interest to Date as Outstanding,
and paying it Redeems it. Waived Amounts and Forfeiture profit or loss recorded before
this release may move by up to one day's interest (pro-rata) or one month's (Full month,
closed on an Accrual Date), as they are now worked out from the Outstanding on the
Closure date. Redeemed Mortgages are unaffected: they still owe nothing.

On Windows, use the banner's **Install now**. Elsewhere:

```sh
git pull
docker compose pull
docker compose up -d
```

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
  Documentation/GLOSSARY.md). Paying the whole Redemption Amount is refused: that is a Redemption.
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
