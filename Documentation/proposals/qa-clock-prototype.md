# Prototype: request-scoped QA clock

**Throwaway sketch** for [Prototype: Stateless request-scoped time-travel hook in platform/db.py](https://github.com/krucx/Mortgage-Management-App/issues/421). Not production code. React to the shape, not the polish.

## What already exists

Business "today" already has a seam — and it is **`platform/clock.py`**, not `platform/db.py` (the architecture proposal mislocated it).

```python
# today
def get_today(request: Request) -> date:
    today: Callable[[], date] = request.app.state.today
    return today()

# create_app wires the process clock (unit tests pin it):
app.state.today = today   # default: date.today
app.state.now = now       # default: datetime.now
```

Unit tests already time-travel by swapping those callables. Docker QA cannot: the app process keeps wall-clock `date.today` / `datetime.now`.

## Rough take: header overrides the existing seam

```python
# platform/clock.py — sketch only
import os
from datetime import date, datetime
from fastapi import HTTPException, Request, status

_QA = os.getenv("QA_MODE") == "true"


def get_today(request: Request) -> date:
    if _QA:
        raw = request.headers.get("X-QA-Clock")
        if raw:
            try:
                return date.fromisoformat(raw)  # YYYY-MM-DD
            except ValueError:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad X-QA-Clock")
    return request.app.state.today()


def get_now(request: Request) -> datetime:
    if _QA:
        raw = request.headers.get("X-QA-Clock-Now")
        if raw:
            try:
                return datetime.fromisoformat(raw)
            except ValueError:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad X-QA-Clock-Now")
        # If only the date header is set, pin "now" to noon that day
        # so Interest-to-Date / audit stamps stay on the same calendar day.
        day = request.headers.get("X-QA-Clock")
        if day:
            try:
                return datetime.fromisoformat(f"{day}T12:00:00")
            except ValueError:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad X-QA-Clock")
    return request.app.state.now()
```

Playwright side (also sketch):

```ts
await page.setExtraHTTPHeaders({ "X-QA-Clock": "2026-12-05" });
// every subsequent page/API fetch from this context carries the date
```

### Properties this sketch claims

| Claim | How |
| --- | --- |
| Stateless / race-free | Header is request-local; parallel contexts can differ |
| Production-safe | Headers ignored unless `QA_MODE=true` at process start |
| Unit tests unchanged | No header → still `app.state.today` / `.now` |
| Replay, Interest to Date, Accrual Dates, Advance landings | All go through `TodayDep` → see the header |

> **Decided (#447, map #444):** option 1, one clock. In QA mode the `run_daily_jobs`
> middleware resolves the request's date with `get_today` and passes it to
> `DailyRun.run_if_due(day)`, so `X-QA-Clock` drives Reminder queueing and the weekly
> Backup-due check too. The clock may move backwards: DailyRun remembers every date it has
> run, not only the latest. A bad header is a 400 on any `/api/` request. Outside QA mode
> the header is ignored, so nothing changes. This replaces the #426 decision.

## The gap the sketch does **not** close: DailyRun

Reminders (and the weekly Backup check) are **not** driven by `TodayDep`. They use the process callable passed into `DailyRun` / `Backups` at startup:

```
first /api/* request of a calendar day
  → daily_run.run_if_due()
  → today = self.today()   # app.state.today, NOT the request header
  → jobs["reminders"](today)
```

So with only the sketch above:

- **Works:** Mortgage page / payments / Replay as of `X-QA-Clock` — Advance Instalments land in the Ledger when their Accrual Date ≤ header date.
- **Does not work:** Time-traveling a browser request to an Accrual Date does **not** by itself queue that day's Reminders. DailyRun still believes wall-clock today.

Three ways to close that (pick later; the sketch deliberately leaves it open):

1. **Request-aware DailyRun** — middleware reads the same resolved "today" and passes it into `run_if_due(today)`. Header time-travel then fires Reminder sync. (Closest to "one clock for everything.")
2. **Process clock for golden runs** — seed + restart app with a pinned `today=` callable for Reminder scenarios; headers only for Ledger/UI paths. (Two mechanisms.)
3. **Out of scope for headers** — assert Reminders only via API scenarios that already pin `create_app(today=…)`; Playwright E2E does not claim Reminder time-travel.

## What this prototype is asking you to react to

1. Seam stays in `clock.py` (correct the architecture doc's `db.py`).
2. Header layers *on top of* the existing injectable callables — does not replace them.
3. Invalid header → 400 (fail loud in QA), not silent fallback.
4. Date-only header implies `now = that day at 12:00` unless `X-QA-Clock-Now` is also set.
5. DailyRun / Reminders are an open follow-on decision, not silently assumed solved.
