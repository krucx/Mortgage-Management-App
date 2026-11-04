# Notes for whoever writes the next chapter

## The owner's preferences

- The plan lives in GitHub issues. [Map #92](https://github.com/krucx/Mortgage-Management-App/issues/92) has every decision; each chapter issue (label `onboarding`) and its lesson sub-issues say exactly what to write. Read the chapter issue first, then its lesson-plan ticket for the reasoning.
- Commit straight to `main`, staging only `Documentation/onboarding/`. Close the chapter issue and its lesson sub-issues when the chapter is pushed.
- One cast across the course: the sample book (`docs/sample-book/book.py`) on 19 Oct 2026. Keep the people and Mortgage Names exactly as `book.py` makes them; `reference/cast.html` lists them.
- Use `GLOSSARY.md` terms exactly. Never "loan", "borrower", "balance" or "due date" in course prose, except when teaching the *Avoid* words.
- Say "the sample book's Default Terms" (2% a month, Compounded Yearly, pro-rata, set by `book.py`). A fresh database's Default Terms are 3%, Compounded Yearly, full month (migration 0001).
- Reference sheets grow chapter by chapter, never show line numbers, and never link ahead to an unwritten chapter. The same goes for lesson pages: mention a later chapter by number, but link only the syllabus.

## Chapter 001 (written at 61bbea2)

- No source code, by decision (#97). Figures are hand-worked from Terms. Each Outstanding the story also gives points to The Gold Chain Story so the reader can check it; chapter 002 has them recheck on their own served book.
- `001-what-the-app-does/scripts/check_figures.py` builds the sample book in a temp folder and prints every Ledger, the Preview, the Call List and the Dashboard. Rerun it when the code changes and compare with the lessons.
- Things learnt while checking figures, useful for 004 and 005:
  - Each month's interest is rounded to the rupee (2.5% of ₹61,500 = ₹1,537.50 shows as ₹1,538).
  - On 10 Oct the bangles' ₹6,000 paid ₹5,000 of unpaid interest and ₹1,000 of the Interest to Date ahead; on 19 Oct the Ledger shows ₹2,500 Interest to Date with ₹1,500 of it unpaid.
  - The chain's Preview at ₹90,000 moves owed-today from ₹83,333 to ₹95,600.

## Chapter 002 (written at 55ee8cb)

- `002-find-your-way-and-run-it/scripts/run_throughs.py` prints every figure and message the chapter quotes: both Default Terms, the chain (id 2) and Lakshmi's necklace (id 4) on the served book, `book.py`'s refusal in a used folder, and the Backup a fresh app writes at once.
- The check-yourself exercise (`"300"` → `"200"` in migration 0001) fails **7 of 8** tests, not just the one named after 3%: the six parametrized invalid-terms cases also compare with `DEFAULTS` at line 50. Issue #128 expected one; the page teaches the seven.
- Sample-book ids are stable: the chain is `/mortgages/2`, the necklace `/mortgages/4`. Later chapters can link straight to them on `127.0.0.1:8765`.
- A fresh app takes a Backup at start-up as well as on the first `/api/` request of the day (`lifespan` calls `backup.start_if_due`), so a fresh `BACKUP_DIR` gets a zip immediately.
- On the owner's laptop the real app runs from this clone as Compose project `mortgage-management-app` on :8080, with a `.env` pointing at real data. Lesson 5 (and `commands.html`) therefore add `-p mortgage-dev` and `APP_PORT=8081` to the README's dev compose command. Chapter 014 should keep that.
- Vite listens on `localhost` (IPv6 on macOS); curl `localhost:5173`, not `127.0.0.1:5173`.
- Chapter 001's promise ("chapter 002 has you check" Lakshmi's ₹2,03,600) is kept in lesson 4.

## Chapter 003 (written at 361c7fa)

- `003-one-payment-end-to-end/scripts/run_throughs.py` makes the reader's Payment through the API (₹6,600 UPI on 19 Oct: ₹5,000 bangles, ₹1,600 chain) and prints the list, the Preview, the saved rows, the Receipt and its WhatsApp text, a back-dated variation and the over-by-₹1 refusal.
- On a fresh book the new Payment is **id 34**; its Allocations are rows 35 (bangles, Mortgage 5) and 36 (chain, Mortgage 2). Meera is Customer 1. Her 10 Sep Payment is id 23. Later chapters can rely on these.
- **The form's date is the browser's real today**, not the served clock: on `/payments/new` the list request 422s ("The date cannot be in the future") until the reader sets 19 Oct 2026. Any later lesson that has the reader fill in a dated form on the served book must say so.
- The form lists the bangles before the chain (newest first), so the body's Allocations are bangles then chain.
- After the save, Payment 34 divides as: bangles ₹1,500 interest + ₹3,500 Principal; chain ₹1,600 + ₹0. A back-dated ₹2,000 on 15 Oct to the chain makes Payment 34's chain line ₹1,333 + ₹267 (useful for 004).
- The check-yourself exercise (commenting out `check_replays` at `changes.py:303`) fails exactly the 5 tests issue #134 named. Without it the overpayment raises `Overpayment` in the next replay of the same request, giving a **500** (not a 422); the transaction still rolls back.
- `reference/traps.html` lists only traps met so far (by number, with fixed ids `t1`…), and never links to unwritten chapters. Add rows as chapters meet them.
- Don't let readers press Send in WhatsApp: the sample book's numbers are invented but realistic.
