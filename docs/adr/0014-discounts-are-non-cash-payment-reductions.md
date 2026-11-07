# Discounts are non-cash reductions alongside a Payment

A Discount is recorded per Mortgage Allocation, beside any cash amount. It is not money received, a separate Payment, or a Waiver: it reduces the debt without closing the Mortgage by itself. Keeping it on the Allocation means the facts replay with the cash and can be reversed with that Payment.

For each Mortgage on a Payment date, apply the cash Allocation first, then the Discount. Each part pays unpaid interest, Interest to Date, and Principal in that order. The Payment is checked against the Outstanding using the combined cash and Discount; a Discount cannot reduce the Mortgage below zero. The screen asks the Lender to confirm a Discount over ₹500 and asks before reducing an over-balance Discount to the remaining Outstanding.

Discounts are non-cash. They do not increase the Payment amount, Receipt cash total, Cash Limit warnings, or cash-based reports. A Payment may have zero cash if it has a Discount. If cash plus Discount covers the whole Outstanding, the Mortgage is Redeemed in that Payment. Reopening that Redemption Voids its Final Payment, which reverses both its cash and Discount on Replay.

We considered making Discount a Closure or storing it separately from the Payment. A Closure would incorrectly stop later interest and require Reopen to undo an ordinary reduction; separate storage would make correction and Replay harder to follow. Recording it on the Allocation preserves the existing Payment/Replay history while making its non-cash nature explicit.
