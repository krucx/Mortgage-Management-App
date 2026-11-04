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
