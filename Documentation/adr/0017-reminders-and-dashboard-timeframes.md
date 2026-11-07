# Reminders replace Notices, and dashboard totals use selected dates

The app's follow-up message is called a Reminder throughout the product, public API,
documentation and database schema. Notice is reserved for a future, distinct concept.
The old Notice API is removed when the Reminder API is introduced; this is a coordinated
rename for the app's own client, not a compatibility period. Existing Reminder records
and relationships are preserved by a schema migration. An unsent Reminder contains only
Mortgages that remain Active and accrue on its date. Sent and skipped Reminders remain
available as history.

The Dashboard defaults its activity timeframe to the current calendar month and allows
custom start and end dates, both inclusive. Principal lent is the original principal of
Mortgages started in that timeframe. Principal redeemed is the sum of non-Voided
Payment allocations applied to Principal in that timeframe, regardless of Mortgage
status; this includes final payments on Mortgages later Waived. Interest collected is
the sum of non-Voided Payment allocations applied to interest in that timeframe. These
are payment and lending activity totals, not balances or counts of Mortgage statuses.

The KPI group sits below Owed on Active Mortgages. Existing Dashboard sections remain.
This keeps the common calendar-month view one click away while letting the Lender inspect
unusual periods without changing the meaning of the totals.
