# Mortgage Management

A jewellery-pledge lending book kept by a single Lender on their own laptop: who borrowed, against what, how interest grows, and what has been paid.

## People

**Lender**:
The single person who runs the app and lends money against pledged jewellery.
_Avoid_: Loaner, loanee, user, admin

**Customer**:
A person who has borrowed from the Lender by pledging jewellery.
_Avoid_: Borrower, loanee, client

**Referrer**:
A person who introduced one or more Customers to the Lender; either an existing Customer or a person known only as a Referrer.
_Avoid_: Reference

**Standalone Referrer**:
A Referrer who is not a Customer, known only by name, address and phone.
_Avoid_: External referrer, contact

**Primary Number**:
The 10-digit mobile number that identifies a person: a Customer's contact number 1 or a Standalone Referrer's phone. No two people share one.
_Avoid_: Customer ID, main phone

**Aadhaar Number**:
The last 4 digits of a Customer's Aadhaar, as their masked Aadhaar shows them; the full number is never kept.
_Avoid_: UID, Aadhaar ID

**PAN**:
A Customer's Permanent Account Number, which no two Customers share.
_Avoid_: PAN number, tax ID

**ID Photos**:
Photos of a Customer's Aadhaar card (the masked front) and PAN card, kept on the Customer and shown only on their page and form.
_Avoid_: KYC documents, ID proof

## Lending

**Mortgage**:
One loan against one pledged packet of jewellery, which may contain several pieces described together.
_Avoid_: Loan, pledge, item

**Mortgage Name**:
A human-readable label for a Mortgage, beginning with the year it started.
_Avoid_: Pledge number, mortgage ID

**Terms**:
A Mortgage's rate, Interest Mode and Part-Month Rule, set when it is created. The starting Terms may be corrected later by editing the Mortgage; a Term Change applies new Terms from its dated Accrual Date onward.

**Default Terms**:
The Terms the Lender has set to be copied into every new Mortgage.
_Avoid_: Global rate, settings

**Lent Through**:
How a Mortgage's Principal was handed to the Customer: Cash, UPI or bank transfer.
_Avoid_: Disbursal mode, payout

**Term Change**:
A dated change to some of a Mortgage's Terms, starting on an Accrual Date and applying to the months from then on. Correcting a Mortgage's starting Terms replays its existing Ledger, but a Term Change remains in force from its original date.
_Avoid_: Rate edit, amendment

**Principal**:
The amount on a Mortgage on which interest is charged; grows when unpaid interest is capitalised and shrinks when payments exceed interest.

**Accrual Date**:
The monthly day on which a month's interest is added, charged on the Principal as it stood when that month began, at the previous Accrual Date before that day's Payments; taken from the start date and clamped to month-end when the month is shorter.
_Avoid_: Due date, interest date

**Interest Mode**:
How a Mortgage's interest grows: Simple, Compounded Yearly (simple monthly, capitalised every year), or Compounded Monthly.

**Capitalisation**:
Moving unpaid interest into Principal at the end of a compounding period.
_Avoid_: Compounding event, rollover

**Part-Month Rule**:
How the Interest to Date is charged for a month under way: pro-rata (each day started, out of 30), full month (the whole month once it starts), or nothing.

**Interest to Date**:
The interest for the month under way, as of a date, under its Part-Month Rule: counted from its first day (the start or an Accrual Date) through that date, so today is always charged; it changes from day to day until the month's interest is charged on the next Accrual Date, and is fixed at a Closure.
_Avoid_: Accrued interest, part-month charge, pending interest

**Ledger**:
The step-by-step history of a Mortgage — interest added, capitalisations, payments — derived from its terms and payments.
_Avoid_: Statement, MortgageLedger

**Replay**:
Working out a Mortgage's Ledger or Outstanding from its stored facts — its Terms, Term Changes, Closure and the Allocations of its non-Voided Payments — rather than storing them (ADR 0001).
_Avoid_: Recalculation, recompute, refresh

**Projection**:
The Ledger continued into the future under stated assumptions, used to compare outcomes before a decision.
_Avoid_: Forecast, estimate

**Simulation**:
A made-up Mortgage (an amount, a start date, Terms and perhaps planned Payments: a monthly amount and Lump Sums) worked out exactly as a real one's Ledger would be, to size up a loan before lending; it has no Customer, only perhaps a jewellery value for its Loan-to-Value, and is never kept.
_Avoid_: Quote, estimate, dummy mortgage

**Lump Sum**:
A one-off planned Payment in a Simulation: an amount on a date, paid as a real Payment would be, beside any monthly amount paid on every Accrual Date.
_Avoid_: One-time payment, prepayment, part payment

**Preview**:
What a change would do, shown before it is saved: the change is made and then undone, so a Preview is refused exactly when saving would be.
_Avoid_: Dry run, simulation

**Trend**:
The monthly average of the last 3 full months (Payments received, Principal lent, Redemptions) carried forward as an estimate; nothing is replayed, so unlike a Projection it is never exact.
_Avoid_: Forecast, prediction

**Outstanding**:
What a Mortgage owes on a date: Principal plus unpaid interest plus its Interest to Date, so exactly what would redeem it that day; nothing once closed.
_Avoid_: Redemption Amount, balance, dues, payoff

## Collateral

**Gold Rate**:
The Lender's current price per gram of gold of one purity.
_Avoid_: Market rate, price

**Collateral Value**:
The current estimated worth of a Mortgage's jewellery: its net weight at the Gold Rate for its purity, unless the Lender sets a value by hand.
_Avoid_: Product value, current_product_value

**Loan-to-Value**:
A Mortgage's Outstanding as a share of its Collateral Value.
_Avoid_: LTV ratio, coverage

## Payments

**Payment**:
A single sum received from a Customer on one date, possibly covering several Mortgages; any Final Payments in it are kept as parts of it, sharing its one Receipt. Under a Grace Period its date is earlier than the date it was received, and both are kept.
_Avoid_: Receipt (that is the acknowledgement of a Payment), collection

**Final Payment**:
What a Mortgage is paid as it is Redeemed or Waived: kept as its own part of the Payment it came in, so a Reopen Voids it alone and leaves the rest.
_Avoid_: Settlement, closing payment

**Receipt**:
The acknowledgement of a Payment for the Customer: what each Mortgage was paid and still owes (or that it was Redeemed), and for a Grace Payment the date it was received and what each Mortgage was let off, sent on WhatsApp or printed; it names each Mortgage by its description, never its Mortgage Name.
_Avoid_: Invoice, bill

**Allocation**:
The portion of a Payment applied to one Mortgage; within a Mortgage it pays unpaid interest, then the Interest to Date (paid ahead of that month's interest), then Principal.
_Avoid_: Split, contribution

**Discount**:
A non-cash reduction to what a Customer owes on one Mortgage, recorded alongside that Mortgage's cash Allocation in a Payment. Cash is applied first; the Discount then pays unpaid interest, the Interest to Date, and Principal, in that order. It can contribute to Redeeming the Mortgage. Voiding the Payment, including when Reopen undoes a Redemption, reverses both the cash and Discount.
_Avoid_: Waiver (a Discount does not itself close a Mortgage)

**Grace Period**:
The few days the Lender allows after an Accrual Date within which a Payment may be dated the day before that Accrual Date, as if paid on time, letting off what paying late would have cost; 3 days unless the Lender changes it, or none. A Payment dated this way keeps the date it was actually received and, for each Mortgage, the amount let off, so the Grace can be shown later.
_Avoid_: Waiver (that is a Closure), allowance, grace days

**Favours Given**:
Every Grace, Discount and Waived Amount the Lender has given a Customer across their Mortgages and still standing, each with its date and amount let off.
_Avoid_: Concessions, waivers

**Cash Limit**:
The amount at or above which the Lender is warned before lending or receiving it in cash, since Government of India rules ask for UPI or bank transfer instead; each Payment is one sum (its Final Payments included), and so is each Mortgage's Principal lent.
_Avoid_: Cash cap, cash ceiling

**Void**:
Cancelling a recorded Payment with a reason, keeping it on record but excluding it from every Ledger.
_Avoid_: Delete, reverse

## Follow-up

**Reminder**:
A message to a Customer, sent ahead of Accrual Dates, covering every one of their Mortgages accruing on that day; queued by the daily run, then approved (if the Lender chose to), sent or skipped. A Reminder that can still be sent includes only Mortgages that remain Active and accrue on that date; sent or skipped Reminders remain as history.
_Avoid_: Notice, notification

**Months Unpaid**:
How many of a Mortgage's latest monthly interest charges (never its Interest to Date) its Payments have not yet covered, counting Payments against the oldest interest first and interest paid ahead against its own month; capitalised interest still counts as unpaid.
_Avoid_: Months overdue, arrears

**Call List**:
The day's Mortgages the Lender should phone about: too many Months Unpaid, Loan-to-Value too high, or accruing today.
_Avoid_: Due list, payments due

**Call Note**:
The Lender's record of phoning a Customer about a Mortgage, with what was said.
_Avoid_: Follow-up, contact log

**Call Sheet**:
The day's Call List as a printable or Excel sheet, a row per Mortgage, for whoever makes the calls to write each Call Note on; the Excel sheet is imported back to record them all at once.
_Avoid_: Export, call report

## Safekeeping

**Secret scanning alert**:
A GitHub finding that a credential may be exposed in repository content or history; its issue tracker entry contains metadata and location, never the secret value.
_Avoid_: Secret, credential issue

**History**:
The record of every change to a Customer, Mortgage or Payment — when, what, and the old and new values — which is never edited or removed.
_Avoid_: Log, changelog, activity

**Backup**:
A copy of all the Lender's data — the database and photos — kept in a folder outside the app, from which everything can be restored.
_Avoid_: Export, snapshot, archive

## Status

**Active**:
A Mortgage still accruing interest with jewellery held.

**Dormant**:
An Active Mortgage that owes nothing, so its jewellery should already have gone back: usually a recording slip, put right by Redeeming it.
_Avoid_: Ready to Redeem, paid up

**Redeemed**:
A Mortgage fully repaid with its jewellery returned to the Customer.
_Avoid_: Settled, paid off

**Closure**:
The end of a Mortgage, by Redemption, Waiver or Forfeiture; after it no interest accrues and no Payments are taken, unless it is Reopened.
_Avoid_: Closing out, termination

**Waived**:
A Mortgage closed with the jewellery returned although the Customer's final Payment fell short of its Outstanding on the Closure date (or there was none): the Lender, at their discretion, lets off the rest, the Waived Amount.
_Avoid_: Written off, settled, discounted

**Forfeited**:
A Mortgage on which the Customer defaulted and the Lender kept or sold the jewellery.
_Avoid_: Defaulted, auctioned

**Reopen**:
Undoing a Closure made by mistake, with a reason: the Mortgage is Active again as if it had never been closed, and a Redemption's or Waiver's final Payment is Voided.
_Avoid_: Undo, unclose, revive

**Recovered Amount**:
What a Forfeited Mortgage's jewellery fetched (or is worth, if kept); its difference from the Outstanding on the Closure date is the Lender's profit or loss.
_Avoid_: Sale value, realisation
