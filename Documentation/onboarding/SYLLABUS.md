# Syllabus

Each chapter assumes only the chapters before it. The order was agreed in [Decide the onboarding chapter list and order (#94)](https://github.com/krucx/Mortgage-Management-App/issues/94). Each chapter has its own issue (label `onboarding`), with a sub-issue per lesson, and closes when `/teach` pushes it.

| # | Chapter | Folder | The reader will be able to | Status |
| --- | --- | --- | --- | --- |
| 001 | [What the app does, in plain words](https://github.com/krucx/Mortgage-Management-App/issues/122) | `001-what-the-app-does/` | explain Mortgages, Payments, Closures and the Lender's day in plain words, with no code | written (61bbea2) |
| 002 | [Find your way and run it](https://github.com/krucx/Mortgage-Management-App/issues/128) | `002-find-your-way-and-run-it/` | name the repo's parts, run it locally on scratch data, find a glossary term or ADR | planned |
| 003 | [One Payment, end to end](https://github.com/krucx/Mortgage-Management-App/issues/134) | `003-one-payment-end-to-end/` | follow one Payment from form → Preview → API → Ledger → Receipt | planned |
| 004 | [The Ledger engine](https://github.com/krucx/Mortgage-Management-App/issues/140) | `004-the-ledger-engine/` | hand-trace any Mortgage's interest, Capitalisation and Payment order | planned |
| 005 | [Replay and Closures](https://github.com/krucx/Mortgage-Management-App/issues/146) | `005-replay-and-closures/` | explain Outstanding, Redeem/Waive/Forfeit/Reopen and Dormant | planned |
| 006 | [Changes and Previews](https://github.com/krucx/Mortgage-Management-App/issues/152) | `006-changes-and-previews/` | add a change route that refuses, writes, checks and records History | planned |
| 007 | [Payments and Receipts](https://github.com/krucx/Mortgage-Management-App/issues/158) | `007-payments-and-receipts/` | explain Allocations, Final Payments, `received_with`, Voids, the Cash Limit and Receipts | planned |
| 008 | [People and Collateral](https://github.com/krucx/Mortgage-Management-App/issues/164) | `008-people-and-collateral/` | explain the Primary Number, Referrers, ID Photos, Gold Rates and Loan-to-Value | planned |
| 009 | [Follow-up](https://github.com/krucx/Mortgage-Management-App/issues/170) | `009-follow-up/` | explain Notices, the Call List, Call Notes and Call Sheets, and WhatsApp messages | planned |
| 010 | [Platform, database and migrations](https://github.com/krucx/Mortgage-Management-App/issues/176) | `010-platform-database-and-migrations/` | add a migration safely; know the clock, the daily run and the composition root | planned |
| 011 | [The frontend's data layer](https://github.com/krucx/Mortgage-Management-App/issues/182) | `011-the-frontends-data-layer/` | fetch, preview and propose a change from a page | planned |
| 012 | [Frontend pages and the PWA](https://github.com/krucx/Mortgage-Management-App/issues/188) | `012-frontend-pages-and-the-pwa/` | build a page from existing components; explain the service worker, StartGate and UpdateBanner | planned |
| 013 | [Testing](https://github.com/krucx/Mortgage-Management-App/issues/195) | `013-testing/` | write backend and frontend tests with the repo's fixtures, seeds and fakes; run the type checks and Pester | planned |
| 014 | [How it runs on the Lender's laptop](https://github.com/krucx/Mortgage-Management-App/issues/201) | `014-how-it-runs-on-the-lenders-laptop/` | run and debug Docker, `screens.py` mode and the Windows installer | planned |
| 015 | [Releases, updates and Backups](https://github.com/krucx/Mortgage-Management-App/issues/207) | `015-releases-updates-and-backups/` | cut a release, explain updates and where Backups go | planned |
| 016 | [Your first change](https://github.com/krucx/Mortgage-Management-App/issues/213) | `016-your-first-change/` | make one small change test-first through every layer, following the repo's workflow | planned |

## Planned lessons

### 001 What the app does, in plain words (written)
1. A pledge, in plain words ([#123](https://github.com/krucx/Mortgage-Management-App/issues/123))
2. How what's owed grows ([#124](https://github.com/krucx/Mortgage-Management-App/issues/124))
3. Paying it back ([#125](https://github.com/krucx/Mortgage-Management-App/issues/125))
4. How a Mortgage ends ([#126](https://github.com/krucx/Mortgage-Management-App/issues/126))
5. The Lender's day, and the one big idea ([#127](https://github.com/krucx/Mortgage-Management-App/issues/127))

### 002 Find your way and run it
1. The repo at a glance ([#129](https://github.com/krucx/Mortgage-Management-App/issues/129))
2. Inside the backend and the frontend ([#130](https://github.com/krucx/Mortgage-Management-App/issues/130))
3. The words and the decisions ([#131](https://github.com/krucx/Mortgage-Management-App/issues/131))
4. Serve the sample book ([#132](https://github.com/krucx/Mortgage-Management-App/issues/132))
5. Run it while you code ([#133](https://github.com/krucx/Mortgage-Management-App/issues/133))

## Reference sheets

Seven shared sheets in `reference/`, decided in [#121](https://github.com/krucx/Mortgage-Management-App/issues/121). They grow chapter by chapter, name files and symbols but never line numbers, and record in their footer the commit they were last checked against.

| Sheet | What it lists | Created by |
| --- | --- | --- |
| `glossary.html` | Every `GLOSSARY.md` term, word for word, with its *Avoid* words and the chapter that teaches it | 001 |
| `cast.html` | The sample book on 19 Oct 2026: people, Mortgages, items, Terms, key figures; later the tests' cast | 001 |
| `commands.html` | Every command a developer runs | 002 |
| `routes.html` | Every route: what it changes, its Preview twin, when it refuses, its History `Action` | 003 |
| `traps.html` | The 20 newcomer surprises, each linked to the chapter that owns it | 003 |
| `ledger.html` | The order inside a day, one month's interest, Capitalisation, Outstanding, the Closure rules | 004 |
| `frontend.html` | The data hooks, cache keys, what goes stale, each page and the routes it calls | 011 |
