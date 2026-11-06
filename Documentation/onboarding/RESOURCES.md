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
  Why the Lender presses Send. Use for: 001.03, 003.05, Receipts and Follow-up.
- [ADR 0003: Backups go to a cloud-synced folder](../adr/0003-backup-to-synced-folder.md)
  Where Backups go and when. Use for: 001.05, Releases and Backups.
- [ADR 0004: The app ships as a Docker Compose stack](../adr/0004-docker-compose-on-lender-laptop.md)
  Why the Lender runs Docker. Use for: 002.01 (named only), chapter 014.
- [ADR 0013: One image: the backend serves the screens in Docker too](../adr/0013-one-image-backend-serves-screens-in-docker.md)
  Why Docker runs one image and one Compose service, `app`, with no nginx. Use for: 002.01 (named only), 010.01, chapter 014.
- [ADR 0005: A person is identified by their Primary Number](../adr/0005-primary-number-identifies-a-person.md)
  Why one phone number is one person. Use for: 002.04 (why `book.py` refuses a used folder), People and Collateral.
- [ADR 0007: Each change's Preview route is written out by hand](../adr/0007-preview-routes-written-out-by-hand.md)
  Why Previews run the real change and roll back, with a thin route each. Use for: 003.02, Changes and Previews.
- [ADR 0010: Without Docker, the backend serves the built screens](../adr/0010-backend-serves-screens-without-docker.md)
  Why `serve.py` and the Windows app need no Node.js. Use for: 002.01, 002.04, chapter 014.
- [README.md, Development](../../README.md)
  The hot-reload, Docker and test commands. Use for: 002.04, 002.05.
- [Documentation/agents/domain.md](../agents/domain.md)
  How agents (and developers) use the glossary and ADRs. Use for: 002.03.
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
- [uv documentation](https://docs.astral.sh/uv/)
  The Python package manager behind `uv run`. Use for: 002, installing and running the backend.
- [Vite: server.proxy](https://vite.dev/config/server-options.html#server-proxy)
  How the dev server passes `/api` on. Use for: 002.05.
- [FastAPI: Bigger applications, multiple files](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
  Routers and `include_router`. Use for: 002.02.

- [TanStack Query: Query invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
  How `invalidateQueries` marks cached answers stale and refetches those on screen. Use for: 003.05, chapter 011.
- [Pydantic: Models](https://docs.pydantic.dev/latest/concepts/models/)
  The classes FastAPI parses request bodies into, such as `PaymentIn`. Use for: 003.03.
- [Chrome DevTools: Inspect network activity](https://developer.chrome.com/docs/devtools/network)
  Filtering and reading requests in the Network tab. Use for: 003.01.
- [Pydantic: Discriminated unions](https://docs.pydantic.dev/latest/concepts/unions/#discriminated-unions)
  How `ReferrerChoice` picks one model by its `kind` field. Use for: 008.02.
- [Pillow: `ImageOps.exif_transpose`](https://pillow.readthedocs.io/en/stable/reference/ImageOps.html#PIL.ImageOps.exif_transpose)
  Why a phone photo is rotated before it's saved. Use for: 008.04.
- [Python: `uuid.uuid4`](https://docs.python.org/3/library/uuid.html#uuid.uuid4)
  The random part of every photo's file name. Use for: 008.04.

## Where to get help

- The issue tracker: GitHub Issues on krucx/Mortgage-Management-App (see `Documentation/agents/issue-tracker.md`). Use for: reporting something in the course or the code that looks wrong.
- An agent in this repo. Use for: "explain this term, screen or rule to me".
- The owner. Use for: questions the documents don't answer.

## Gaps

- No ADR explains the three Interest Modes or the Part-Month Rules; the glossary is the only source. Chapter 004 teaches them from `ledger.py`.
- No ADR covers the Cash Limit; `payments/cash_limit.py` and the glossary are the sources.
- No ADR covers how photo files are kept in step with the database, or how Collateral Value is rounded; `platform/photos.py`, `collateral/collateral.py` and their tests are the sources. Chapter 008 teaches both from the code.
