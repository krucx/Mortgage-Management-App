# QA scenarios

The Gherkin scenarios in `features/` run against the real stack with
`scripts/qa-stack.sh test`; the root [README](../README.md#tests-and-type-checks) says how.
This file covers how to add to them without colliding with other work in flight.

## Steps

- Generic steps, used by any area, live only in `steps/common.steps.ts`: the clock, opening
  screens, dialogs, confirming (`the Lender confirms`), what a confirmation lists or says, and
  the page width. Use one before writing a new one.
- Each area adds its own steps only in its own `steps/<area>.steps.ts`.
- Shared helper classes, such as `Lender` in `steps/lender.ts`, get new methods only at the
  end of the class. Two branches doing so can still conflict there, but only by adding
  methods side by side: keep both.
- Step text is unique across all features: two definitions that match the same step fail
  `bddgen`. After merging `main`, and before reporting a branch ready, run
  `npm run check-steps` here (`npm ci` first); it reports each duplicate it finds and the
  files that define it. The runner image runs the same check when `scripts/qa-stack.sh test`
  builds it.

## The clock

The QA apps run with `QA_MODE=true`, so each request's `X-QA-Clock` header (`YYYY-MM-DD`)
sets the backend's today for that request alone. `today is <day>` (`Lender.on` in
`steps/lender.ts`) sends it on every later request and fixes the browser's clock to the same
day. The day also runs that date's daily jobs, Reminder queueing and the Backup-due check,
even when it is earlier than a day already run, so a scenario tests Reminders by moving the
date. A request that carries no header, such as a file download the browser starts, gets the
container's real date: send the header yourself, as `steps/call-sheets.steps.ts` does.

## Settings are one value for the whole book

A scenario that changes a setting (Default Terms, Cash Limit, Discount confirmation limit,
Grace Period, WhatsApp templates, Backups kept) would change what every scenario running
alongside is asked or offered. Tag it `@settings` (the feature, as in `settings.feature`): the
`settings` project runs those scenarios last, one after another, on the fresh app.

## Screens still to cover

Each route in `frontend/src/App.tsx` is tagged `@screen:<route>` on a scenario, or listed in
`screens-to-cover/<issue>.txt`, one route per line, by the ticket that will cover it. A pull
request that covers its ticket's routes deletes that ticket's file; it edits no other. The
`frontend` CI job checks this with `.github/scripts/check-screen-coverage.mjs`, naming the
file to delete or edit.
