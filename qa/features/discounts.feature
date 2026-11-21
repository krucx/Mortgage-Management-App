Feature: Discounts
  A Discount is a non-cash reduction to what a Customer owes on one Mortgage, recorded beside
  that Mortgage's cash in a Payment. Cash is applied first; the Discount then pays unpaid
  interest, the Interest to Date and Principal, in that order. Figures are asserted as what
  the data says, not worked out by hand (the canonical money scenarios do that).

  Rule: A Discount is recorded beside cash, or alone

    @screen:/payments/new @screen:/payments/:id/receipt @screen:/mortgages/:id
    Scenario: A Discount alongside cash on one Mortgage
      Given "Dcash Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 5 Nov 2025
      When the Lender starts a Payment from "Dcash Customer" for 2025-Dcash-GoldChain
      And enters ₹1,000 as the Amount received
      And enters a Discount of ₹200 for 2025-Dcash-GoldChain
      Then the Record Payment button reads "Record Payment of ₹1,000 with ₹200 Discount"
      When the Lender saves the Payment
      Then the confirmation says "Record a Payment of ₹1,000 cash and Discount?"
      And the confirmation reads:
        | 2025-Dcash-GoldChain | ₹1,000 cash + ₹200 Discount |
      When the Lender confirms
      Then the Receipt page opens
      When the Lender opens 2025-Dcash-GoldChain
      Then its Ledger shows the Payment's Discount of ₹200, split between interest and Principal

    @screen:/payments/new @screen:/payments/:id/receipt @screen:/mortgages/:id
    Scenario: A Discount-only Payment, with no cash
      Given "Donly Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 5 Nov 2025
      When the Lender starts a Payment from "Donly Customer" for 2025-Donly-GoldChain
      And enters a Discount of ₹300 for 2025-Donly-GoldChain
      Then the Record Payment button reads "Record Payment with ₹300 Discount"
      When the Lender saves the Payment
      Then the confirmation reads:
        | 2025-Donly-GoldChain | ₹0 cash + ₹300 Discount |
      When the Lender confirms
      Then the Receipt page opens
      When the Lender opens 2025-Donly-GoldChain
      Then its Ledger shows the Payment's Discount of ₹300, split between interest and Principal

    @screen:/payments/new @screen:/payments/:id/receipt @screen:/mortgages/:id
    Scenario: Discounts on two Mortgages in one Payment
      Given "Dtwo Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹20,000 on 5 Sept 2025 against a Gold ring
      And today is 5 Nov 2025
      When the Lender opens a new Payment from "Dtwo Customer"
      And enters ₹1,000 as the Amount received
      And enters a Discount of ₹100 for 2025-Dtwo-GoldChain
      And enters a Discount of ₹200 for 2025-Dtwo-GoldRing
      Then the Record Payment button reads "Record Payment of ₹1,000 with ₹300 Discount"
      When the Lender saves the Payment
      Then the confirmation reads:
        | 2025-Dtwo-GoldChain | ₹500 cash + ₹100 Discount |
        | 2025-Dtwo-GoldRing  | ₹500 cash + ₹200 Discount |
      When the Lender confirms
      Then the Receipt page opens
      When the Lender opens 2025-Dtwo-GoldChain
      Then its Ledger shows the Payment's Discount of ₹100, split between interest and Principal
      When the Lender opens 2025-Dtwo-GoldRing
      Then its Ledger shows the Payment's Discount of ₹200, split between interest and Principal

    @screen:/payments/new @screen:/payments/:id/receipt @screen:/mortgages/:id
    Scenario: A Discount that Redeems a Mortgage
      Given "Dredeem Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 5 Nov 2025
      When the Lender starts a Payment from "Dredeem Customer" for 2025-Dredeem-GoldChain
      And the Lender pays by UPI
      And the Lender pays the full Outstanding less a Discount of ₹100 for 2025-Dredeem-GoldChain
      And the Lender saves the Payment
      Then the confirmation says "Redeem and hand back the jewellery?"
      And the confirmation reads:
        | 2025-Dredeem-GoldChain | + ₹100 Discount · Redeems it |
      When the Lender redeems them
      Then the Receipt page opens
      When the Lender opens 2025-Dredeem-GoldChain
      Then its Closure reads "Redeemed on 5 Nov 2025"

  Rule: A Discount is held to what is left, and asked about when large

    @screen:/payments/new
    Scenario: A Discount larger than what is left offers to reduce it, and changes only the draft
      Given "Dcap Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 5 Nov 2025
      When the Lender starts a Payment from "Dcap Customer" for 2025-Dcap-GoldChain
      And enters ₹1,000 as the Amount received
      And enters a Discount of ₹1,00,000 for 2025-Dcap-GoldChain
      And the Lender saves the Payment
      Then the Lender is offered to reduce the Discount of ₹1,00,000 for 2025-Dcap-GoldChain to what is left after ₹1,000 cash
      When the Lender reduces the Discount
      Then the Discount for 2025-Dcap-GoldChain is what is left after ₹1,000 cash
      And the Payment is not recorded

    @screen:/payments/new @screen:/payments/:id/receipt
    Scenario: A Discount over the confirmation limit asks to confirm
      Given "Dlimit Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 5 Nov 2025
      When the Lender starts a Payment from "Dlimit Customer" for 2025-Dlimit-GoldChain
      And enters ₹1,000 as the Amount received
      And enters a Discount over the confirmation limit for 2025-Dlimit-GoldChain
      And the Lender saves the Payment
      Then the Lender is asked to confirm a Discount over the limit, listing that Discount for 2025-Dlimit-GoldChain
      When the Lender keeps editing
      Then the Payment is not recorded
      When the Lender saves the Payment
      And the Lender continues
      Then the confirmation says "Record a Payment of ₹1,000 cash and Discount?"
      When the Lender confirms
      Then the Receipt page opens

    @screen:/payments/new
    Scenario: With the confirmation limit cleared, a large Discount is not asked about
      Given "Dnolimit Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And the Discount confirmation limit is cleared
      And today is 5 Nov 2025
      When the Lender starts a Payment from "Dnolimit Customer" for 2025-Dnolimit-GoldChain
      And enters ₹1,000 as the Amount received
      And enters a Discount over the confirmation limit for 2025-Dnolimit-GoldChain
      And the Lender saves the Payment
      Then the confirmation says "Record a Payment of ₹1,000 cash and Discount?"

  Rule: Favours Given lists a Discount until its Payment is undone

    @screen:/customers/:id @screen:/payments/:id @screen:/mortgages/:id
    Scenario: Voiding the Payment removes its Discount and reverses cash and Discount
      Given "Dvoid Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 and a Discount of ₹200 on it on 5 Nov 2025
      And today is 5 Nov 2025
      When the Lender opens the Customer "Dvoid Customer"
      Then their Favours Given lists a Discount of ₹200 on the "Gold chain"
      When the Lender opens that Payment
      And the Lender voids it because "Entered twice"
      And the Lender opens the Customer "Dvoid Customer"
      Then their page lists no Favours Given
      When the Lender opens 2025-Dvoid-GoldChain
      Then its Ledger has no Payment
      And it owes what it did before that Payment

    @screen:/customers/:id @screen:/mortgages/:id
    Scenario: Reopening the Redemption a Discount closed removes it and reverses cash and Discount
      Given "Dreopen Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid its full Outstanding less a Discount of ₹200 on it on 5 Nov 2025
      And today is 5 Nov 2025
      When the Lender opens the Customer "Dreopen Customer"
      Then their Favours Given lists a Discount of ₹200 on the "Gold chain"
      When the Lender opens 2025-Dreopen-GoldChain
      And the Lender reopens it because "Redeemed by mistake"
      Then it is Active
      When the Lender opens the Customer "Dreopen Customer"
      Then their page lists no Favours Given
      When the Lender opens 2025-Dreopen-GoldChain
      Then its Ledger has no Payment
      And it owes what it did before that Payment

  Rule: An Advance and a Discount together never leave more held than is owed

    @screen:/payments/new
    Scenario: An Advance is limited to what is owed after the Payment's cash and Discount
      Given "Dadv Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 5 Nov 2025
      When the Lender starts a Payment from "Dadv Customer" for 2025-Dadv-GoldChain
      And enters a Discount leaving ₹1,000 owed for 2025-Dadv-GoldChain
      And enters an Advance of ₹3,000 over 3 months for 2025-Dadv-GoldChain
      Then the Preview says "2025-Dadv-GoldChain: an Advance of ₹3,000 would hold more than the ₹1,000 it owes on 05 Nov 2025; at most ₹1,000 fits"
      When enters an Advance of ₹1,000 over 1 months for 2025-Dadv-GoldChain
      Then the Payment can be recorded

    Scenario: The app refuses an Advance larger than what is owed after the Discount
      Given "Dadvapi Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 5 Nov 2025
      Then a Payment with an Advance of ₹3,000 over 3 months and a Discount leaving ₹1,000 owed is refused: "2025-Dadvapi-GoldChain: an Advance of ₹3,000 would hold more than the ₹1,000 it owes on 05 Nov 2025; at most ₹1,000 fits"

    @screen:/payments/new
    Scenario: A Discount is refused when upcoming parts would hold more than is owed, naming what to cancel
      Given "Dhold Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid an Advance of ₹6,000 over 2 months on it on 5 Nov 2025
      And today is 5 Nov 2025
      When the Lender starts a Payment from "Dhold Customer" for 2025-Dhold-GoldChain
      And enters a Discount leaving ₹4,000 owed for 2025-Dhold-GoldChain
      Then the Preview says the Advance Instalments would hold ₹6,000, more than the ₹4,000 it would owe; cancel the part on 5 Jan 2026 first, which pays ₹3,000

    Scenario: The app refuses a Discount when upcoming parts would hold more than is owed
      Given "Dholdapi Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid an Advance of ₹6,000 over 2 months on it on 5 Nov 2025
      And today is 5 Nov 2025
      Then a Discount leaving ₹4,000 owed is refused: the Advance Instalments would hold ₹6,000; cancel the part on 5 Jan 2026 first, which pays ₹3,000
