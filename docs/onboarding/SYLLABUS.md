# Syllabus

Each chapter assumes only the chapters before it. The order was agreed in [Decide the onboarding chapter list and order (#94)](https://github.com/krucx/Mortgage-Management-App/issues/94). Each chapter has its own issue (label `onboarding`), with a sub-issue per lesson, and closes when `/teach` pushes it.

| # | Chapter | Folder | The reader will be able to | Status |
| --- | --- | --- | --- | --- |
| 001 | [What the app does, in plain words](https://github.com/krucx/Mortgage-Management-App/issues/122) | `001-what-the-app-does/` | explain Mortgages, Payments, Closures and the Lender's day in plain words, with no code | written (61bbea2) |
| 002 | [Find your way and run it](https://github.com/krucx/Mortgage-Management-App/issues/128) | `002-find-your-way-and-run-it/` | name the repo's parts, run it locally on scratch data, find a glossary term or ADR | written (55ee8cb) |
| 003 | [One Payment, end to end](https://github.com/krucx/Mortgage-Management-App/issues/134) | `003-one-payment-end-to-end/` | follow one Payment from form → Preview → API → Ledger → Receipt | written (361c7fa) |
| 004 | [The Ledger engine](https://github.com/krucx/Mortgage-Management-App/issues/140) | `004-the-ledger-engine/` | hand-trace any Mortgage's interest, Capitalisation and Payment order | written (6f1775b) |
| 005 | [Replay and Closures](https://github.com/krucx/Mortgage-Management-App/issues/146) | `005-replay-and-closures/` | explain Outstanding, Redeem/Waive/Forfeit/Reopen, Dormant, Discount reversals and the Calculator's Simulations | written (16b855c; lesson 6 at 756ae3a) |
| 006 | [Changes and Previews](https://github.com/krucx/Mortgage-Management-App/issues/152) | `006-changes-and-previews/` | add a change route that refuses, writes, checks and records History | written (d6a92ab) |
| 007 | [Payments and Receipts](https://github.com/krucx/Mortgage-Management-App/issues/158) | `007-payments-and-receipts/` | explain cash Allocations, non-cash Discounts, Final Payments, `received_with`, Voids, the Cash Limit and Receipts | written (15df77d) |
| 008 | [People and Collateral](https://github.com/krucx/Mortgage-Management-App/issues/164) | `008-people-and-collateral/` | explain the Primary Number, Referrers, ID Photos, Gold Rates and Loan-to-Value | written (575437c) |
| 009 | [Follow-up](https://github.com/krucx/Mortgage-Management-App/issues/170) | `009-follow-up/` | explain Notices, the Call List, Call Notes and Call Sheets, and WhatsApp messages | written (6e6b030) |
| 010 | [Platform, database and migrations](https://github.com/krucx/Mortgage-Management-App/issues/176) | `010-platform-database-and-migrations/` | add a migration safely; know the clock, the daily run and the composition root | written (b34526a) |
| 011 | [The frontend's data layer](https://github.com/krucx/Mortgage-Management-App/issues/182) | `011-the-frontends-data-layer/` | fetch, preview and propose a change from a page | written (87a96c7) |
| 012 | [Frontend pages and the PWA](https://github.com/krucx/Mortgage-Management-App/issues/188) | `012-frontend-pages-and-the-pwa/` | build a page from existing components; explain the service worker, StartGate and UpdateBanner | written (2c5e561) |
| 013 | [Testing](https://github.com/krucx/Mortgage-Management-App/issues/195) | `013-testing/` | write backend and frontend tests with the repo's fixtures, seeds and fakes; run the type checks and Pester | written (bda77f1) |
| 014 | [How it runs on the Lender's laptop](https://github.com/krucx/Mortgage-Management-App/issues/201) | `014-how-it-runs-on-the-lenders-laptop/` | run and debug Docker, `screens.py` mode and the Windows installer | written (36d403e) |
| 015 | [Releases, updates and Backups](https://github.com/krucx/Mortgage-Management-App/issues/207) | `015-releases-updates-and-backups/` | cut a release, explain updates and where Backups go | written (fceac5d) |
| 016 | [Your first change](https://github.com/krucx/Mortgage-Management-App/issues/213) | `016-your-first-change/` | make one small change test-first through every layer, following the repo's workflow | written (93de7a7) |

## Planned lessons

### 001 What the app does, in plain words (written)
1. A pledge, in plain words ([#123](https://github.com/krucx/Mortgage-Management-App/issues/123))
2. How what's owed grows ([#124](https://github.com/krucx/Mortgage-Management-App/issues/124))
3. Paying it back ([#125](https://github.com/krucx/Mortgage-Management-App/issues/125))
4. How a Mortgage ends ([#126](https://github.com/krucx/Mortgage-Management-App/issues/126))
5. The Lender's day, and the one big idea ([#127](https://github.com/krucx/Mortgage-Management-App/issues/127))

### 002 Find your way and run it (written)
1. The repo at a glance ([#129](https://github.com/krucx/Mortgage-Management-App/issues/129))
2. Inside the backend and the frontend ([#130](https://github.com/krucx/Mortgage-Management-App/issues/130))
3. The words and the decisions ([#131](https://github.com/krucx/Mortgage-Management-App/issues/131))
4. Serve the sample book ([#132](https://github.com/krucx/Mortgage-Management-App/issues/132))
5. Run it while you code ([#133](https://github.com/krucx/Mortgage-Management-App/issues/133))

### 003 One Payment, end to end (written)
1. The journey on one page ([#135](https://github.com/krucx/Mortgage-Management-App/issues/135))
2. The form and the Preview ([#136](https://github.com/krucx/Mortgage-Management-App/issues/136))
3. Saving it ([#137](https://github.com/krucx/Mortgage-Management-App/issues/137))
4. What the Ledger says back ([#138](https://github.com/krucx/Mortgage-Management-App/issues/138))
5. Back to the Customer ([#139](https://github.com/krucx/Mortgage-Management-App/issues/139))

### 004 The Ledger engine (written)
1. The Ledger is a replay ([#141](https://github.com/krucx/Mortgage-Management-App/issues/141))
2. One month's interest ([#142](https://github.com/krucx/Mortgage-Management-App/issues/142))
3. The order inside a day, and what a Payment pays ([#143](https://github.com/krucx/Mortgage-Management-App/issues/143))
4. Capitalisation ([#144](https://github.com/krucx/Mortgage-Management-App/issues/144))
5. Term Changes and Projections ([#145](https://github.com/krucx/Mortgage-Management-App/issues/145))

### 005 Replay and Closures (written)
1. Outstanding: what would Redeem it today ([#147](https://github.com/krucx/Mortgage-Management-App/issues/147))
2. Closing on a date ([#148](https://github.com/krucx/Mortgage-Management-App/issues/148))
3. Redeemed, two ways ([#149](https://github.com/krucx/Mortgage-Management-App/issues/149))
4. Waived and Forfeited ([#150](https://github.com/krucx/Mortgage-Management-App/issues/150))
5. Dormant, and undoing a Closure ([#151](https://github.com/krucx/Mortgage-Management-App/issues/151))
6. A Simulation: a replay with nothing saved ([#233](https://github.com/krucx/Mortgage-Management-App/issues/233))

### 006 Changes and Previews (written)
1. One door for every change ([#153](https://github.com/krucx/Mortgage-Management-App/issues/153))
2. The check: replay, then refuse ([#154](https://github.com/krucx/Mortgage-Management-App/issues/154))
3. History ([#155](https://github.com/krucx/Mortgage-Management-App/issues/155))
4. Previews: make it, then roll it back ([#156](https://github.com/krucx/Mortgage-Management-App/issues/156))
5. Adding a change route ([#157](https://github.com/krucx/Mortgage-Management-App/issues/157))

### 007 Payments and Receipts (written)
1. A Payment and its Allocations ([#159](https://github.com/krucx/Mortgage-Management-App/issues/159))
2. One Payment, several parts ([#160](https://github.com/krucx/Mortgage-Management-App/issues/160))
3. Voids: how a Payment is corrected ([#161](https://github.com/krucx/Mortgage-Management-App/issues/161))
4. The Cash Limit ([#162](https://github.com/krucx/Mortgage-Management-App/issues/162))
5. Receipts ([#163](https://github.com/krucx/Mortgage-Management-App/issues/163))

### 008 People and Collateral (written)
1. Who a person is: the Primary Number ([#165](https://github.com/krucx/Mortgage-Management-App/issues/165))
2. Referrers, and a Referrer who borrows ([#166](https://github.com/krucx/Mortgage-Management-App/issues/166))
3. Adding, editing and deleting a Customer ([#167](https://github.com/krucx/Mortgage-Management-App/issues/167))
4. Photos and ID Photos ([#168](https://github.com/krucx/Mortgage-Management-App/issues/168))
5. Gold Rates, Collateral Value and Loan-to-Value ([#169](https://github.com/krucx/Mortgage-Management-App/issues/169))

### 009 Follow-up (written)
1. The Call List: who to phone today, and why ([#171](https://github.com/krucx/Mortgage-Management-App/issues/171))
2. Call Notes and Call Sheets ([#172](https://github.com/krucx/Mortgage-Management-App/issues/172))
3. The Notice queue is synced, not scheduled ([#173](https://github.com/krucx/Mortgage-Management-App/issues/173))
4. A Notice's life: approve, skip, send ([#174](https://github.com/krucx/Mortgage-Management-App/issues/174))
5. Messages: templates, cards and click-to-send ([#175](https://github.com/krucx/Mortgage-Management-App/issues/175))

### 010 Platform, database and migrations (written)
1. The composition root: how the app is put together ([#177](https://github.com/krucx/Mortgage-Management-App/issues/177))
2. Today, now and the daily run ([#178](https://github.com/krucx/Mortgage-Management-App/issues/178))
3. Settings in the config table ([#179](https://github.com/krucx/Mortgage-Management-App/issues/179))
4. Tables, the engine and lists a page at a time ([#180](https://github.com/krucx/Mortgage-Management-App/issues/180))
5. How the app migrates on every start ([#181](https://github.com/krucx/Mortgage-Management-App/issues/181))
6. Adding a migration safely ([#226](https://github.com/krucx/Mortgage-Management-App/issues/226))

### 011 The frontend's data layer (written)
1. The typed client and the generated types ([#183](https://github.com/krucx/Mortgage-Management-App/issues/183))
2. Reading through one cache ([#184](https://github.com/krucx/Mortgage-Management-App/issues/184))
3. Lists a page at a time ([#185](https://github.com/krucx/Mortgage-Management-App/issues/185))
4. Previews from a draft ([#186](https://github.com/krucx/Mortgage-Management-App/issues/186))
5. Saving, and what goes stale ([#187](https://github.com/krucx/Mortgage-Management-App/issues/187))

### 012 Frontend pages and the PWA (written)
1. The shell and a read page ([#189](https://github.com/krucx/Mortgage-Management-App/issues/189))
2. A form page: draft, Preview, confirm, save ([#190](https://github.com/krucx/Mortgage-Management-App/issues/190))
3. The money forms: New Payment and Closures ([#191](https://github.com/krucx/Mortgage-Management-App/issues/191))
4. The Mortgage and Customer pages ([#192](https://github.com/krucx/Mortgage-Management-App/issues/192))
5. Follow-up, the Dashboard and Settings ([#193](https://github.com/krucx/Mortgage-Management-App/issues/193))
6. The installed app (PWA) ([#194](https://github.com/krucx/Mortgage-Management-App/issues/194))

### 013 Testing (written)
1. Every check, and how to run it ([#196](https://github.com/krucx/Mortgage-Management-App/issues/196))
2. Backend tests through the API ([#197](https://github.com/krucx/Mortgage-Management-App/issues/197))
3. Below the API: seeds and pure tests ([#198](https://github.com/krucx/Mortgage-Management-App/issues/198))
4. Frontend tests: fakeServer and showPage ([#199](https://github.com/krucx/Mortgage-Management-App/issues/199))
5. Finding what no test pins ([#200](https://github.com/krucx/Mortgage-Management-App/issues/200))

### 014 How it runs on the Lender's laptop (written)
1. The app in Docker ([#202](https://github.com/krucx/Mortgage-Management-App/issues/202))
2. Without Docker: the backend serves the screens ([#203](https://github.com/krucx/Mortgage-Management-App/issues/203))
3. Setup on Windows ([#204](https://github.com/krucx/Mortgage-Management-App/issues/204))
4. Each version in its own folder ([#205](https://github.com/krucx/Mortgage-Management-App/issues/205))
5. The mortgage-management:// link ([#206](https://github.com/krucx/Mortgage-Management-App/issues/206))

### 015 Releases, updates and Backups (written)
1. A Backup, start to finish ([#208](https://github.com/krucx/Mortgage-Management-App/issues/208))
2. Cutting a release ([#209](https://github.com/krucx/Mortgage-Management-App/issues/209))
3. How an update reaches the Lender ([#210](https://github.com/krucx/Mortgage-Management-App/issues/210))
4. When an update changes the database ([#211](https://github.com/krucx/Mortgage-Management-App/issues/211))
5. Bringing a Backup back ([#212](https://github.com/krucx/Mortgage-Management-App/issues/212))

## Reference sheets

Seven shared sheets in `reference/`, decided in [#121](https://github.com/krucx/Mortgage-Management-App/issues/121). They grow chapter by chapter, name files and symbols but never line numbers, and record in their footer the commit they were last checked against.

| Sheet | What it lists | Created by |
| --- | --- | --- |
| `glossary.html` | Every `GLOSSARY.md` term, word for word, with its *Avoid* words and the chapter that teaches it | 001 |
| `cast.html` | The sample book on 19 Oct 2026: people, Mortgages, items, Terms, key figures; later the tests' cast | 001 |
| `commands.html` | Every command a developer runs | 002 |
| `routes.html` | Every route: what it changes, its Preview twin, when it refuses, its History `Action` | 003 |
| `traps.html` | The newcomer surprises met so far (of 20), each linked to the chapter that owns it | 003 |
| `ledger.html` | The order inside a day, one month's interest, Capitalisation, Outstanding, the Closure rules | 004 |
| `frontend.html` | The data hooks, cache keys, what goes stale, each page and the routes it calls | 011 |

### 016 Your first change (written)
1. From an idea to an issue ([#214](https://github.com/krucx/Mortgage-Management-App/issues/214))
2. The change, test-first ([#215](https://github.com/krucx/Mortgage-Management-App/issues/215))
3. Preview and History ([#216](https://github.com/krucx/Mortgage-Management-App/issues/216))
4. Through to the screen ([#217](https://github.com/krucx/Mortgage-Management-App/issues/217))
5. Shipping it, and the agent skills ([#218](https://github.com/krucx/Mortgage-Management-App/issues/218))
