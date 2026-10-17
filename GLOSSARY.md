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

## Lending

**Mortgage**:
One loan against one pledged packet of jewellery, which may contain several pieces described together.
_Avoid_: Loan, pledge, item

**Mortgage Name**:
A human-readable label for a Mortgage, beginning with the year it started.
_Avoid_: Pledge number, mortgage ID

**Terms**:
A Mortgage's rate, Interest Mode and Part-Month Rule, fixed when it is created.

**Default Terms**:
The Terms the Lender has set to be copied into every new Mortgage.
_Avoid_: Global rate, settings

**Term Change**:
A dated change to a Mortgage's Terms that applies from its effective date onward and never rewrites earlier interest.
_Avoid_: Rate edit, amendment

**Principal**:
The amount on a Mortgage on which interest is charged; grows when unpaid interest is capitalised and shrinks when payments exceed interest.

**Accrual Date**:
The monthly day on which a month's interest is added, charged on the Principal as it stood at the previous Accrual Date; taken from the start date and clamped to month-end when the month is shorter.
_Avoid_: Due date, interest date

**Interest Mode**:
How a Mortgage's interest grows: Simple, Compounded Yearly (simple monthly, capitalised every year), or Compounded Monthly.

**Capitalisation**:
Moving unpaid interest into Principal at the end of a compounding period.
_Avoid_: Compounding event, rollover

**Part-Month Rule**:
How interest is charged for the days since the last Accrual Date when a Mortgage is redeemed: pro-rata, full month, or nothing.

**Ledger**:
The step-by-step history of a Mortgage — interest added, capitalisations, payments — derived from its terms and payments.
_Avoid_: Statement, MortgageLedger

**Projection**:
The Ledger continued into the future under stated assumptions, used to compare outcomes before a decision.
_Avoid_: Forecast, estimate

**Outstanding**:
What a Mortgage owes on a date: Principal plus unpaid interest, before any Part-Month Rule charge.
_Avoid_: Balance, dues

**Redemption Amount**:
What a Customer must pay on a given date to redeem a Mortgage: outstanding interest and Principal plus any Part-Month Rule charge.
_Avoid_: Payoff, closing balance

## Collateral

**Collateral Value**:
The current estimated worth of a Mortgage's jewellery.
_Avoid_: Product value, current_product_value

## Payments

**Payment**:
A single sum received from a Customer on one date, possibly covering several Mortgages.
_Avoid_: Receipt, collection

**Allocation**:
The portion of a Payment applied to one Mortgage; within a Mortgage it pays interest before Principal.
_Avoid_: Split, contribution

**Void**:
Cancelling a recorded Payment with a reason, keeping it on record but excluding it from every Ledger.
_Avoid_: Delete, reverse

## Follow-up

**Notice**:
A message to a Customer, sent ahead of Accrual Dates, covering every one of their Mortgages accruing on that day.
_Avoid_: Reminder, notification

**Call List**:
The day's Mortgages the Lender should phone about: interest unpaid for too long, outstanding too close to Collateral Value, or accruing today.
_Avoid_: Due list, payments due

## Status

**Active**:
A Mortgage still accruing interest with jewellery held.

**Redeemed**:
A Mortgage fully repaid with its jewellery returned to the Customer.
_Avoid_: Closed, settled

**Forfeited**:
A Mortgage on which the Customer defaulted and the Lender kept or sold the jewellery.
_Avoid_: Defaulted, auctioned
