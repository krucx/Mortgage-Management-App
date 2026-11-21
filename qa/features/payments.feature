Feature: Payments
  A Payment is the cash (and any Discount) a Customer hands over, allocated across one or
  several of their Active Mortgages: equally unless the Lender splits it by amount or by
  percentage. Paying a Mortgage's whole Outstanding Redeems it. Once saved, its Receipt
  opens; the Payments list holds every Payment received.

  @golden
  Rule: The Payments list holds every Payment received, newest first
    The golden book on its last day.

    Background:
      Given today is 15 Nov 2025
      And the Lender opens the Payments list

    @screen:/payments
    Scenario: Filtering the list by Customer, Mortgage Name or reference
      When the Lender filters the Payments by "Meera"
      Then every Payment listed is from "Meera Sharma"
      And the Payment "grace Meera" is listed
      When the Lender filters the Payments by "2025-Ramesh-GoldChain"
      Then every Payment listed pays 2025-Ramesh-GoldChain
      When the Lender filters the Payments by "UPI advance"
      Then only the Payment "UPI advance Ramesh" is listed

    @screen:/payments
    Scenario: Payments received in a month or a year, with the interest they paid
      When the Lender lists the Payments received in October 2025
      Then every Payment listed was received in Oct 2025
      And the summary agrees with the Payments received in October 2025
      When the Lender lists the Payments received in the year 2025
      Then the summary agrees with the Payments received in the year 2025
      When the Lender lists the Payments received at any time
      Then the list has no summary

    @screen:/payments
    Scenario: Badges mark a Grace Payment and an Advance's upcoming parts
      Then the Payment "grace Meera" is marked "Grace"
      And the Payment "UPI advance Ramesh" is marked "Advance · 1 of 3 upcoming"
      And the Payment "split advance Meera" is marked "Advance · 2 of 2 upcoming"

    @screen:/payments
    Scenario: Sorting the list by a column, and reversing it
      When the Lender sorts the Payments by Amount
      Then the Payments are listed by Amount, largest first
      When the Lender sorts the Payments by Amount
      Then the Payments are listed by Amount, smallest first
      When the Lender sorts the Payments by Customer
      Then the Payments are listed by Customer, A to Z

  @screen:/payments
  Scenario: Voided Payments are listed, marked voided, unless the Lender hides them
    Given "Voidlist Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And paid ₹1,000 on it on 5 Oct 2025
    And paid ₹2,000 on it on 5 Nov 2025, voided because "Entered twice"
    And today is 15 Nov 2025
    When the Lender opens the Payments list
    And the Lender filters the Payments by "Voidlist Customer"
    Then 2 Payments are listed
    And the Payment of ₹2,000 is marked "voided"
    When the Lender hides Voided Payments
    Then only the Payment of ₹1,000 is listed

  @screen:/payments
  Scenario: The list comes twenty Payments a page
    Given "Pager Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And paid ₹100 on it 21 times on 15 Nov 2025
    And today is 15 Nov 2025
    When the Lender opens the Payments list
    And the Lender filters the Payments by "Pager Customer"
    Then the list shows "Showing 1–20 of 21" on "Page 1 of 2"
    When the Lender goes to the next page
    Then the list shows "Showing 21–21 of 21" on "Page 2 of 2"

  Rule: A Payment is started from the Payments list, a Customer or a Mortgage

    @screen:/payments @screen:/payments/new
    Scenario: Choosing the Customer on the payment form
      Given "Chooser Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      When the Lender opens the Payments list
      And the Lender starts to record a Payment
      And the Lender chooses the Customer "Chooser Customer"
      Then the Payment is from "Chooser Customer"
      And 2025-Chooser-GoldChain is ticked

    @screen:/payments/new
    Scenario: From a Customer, every Mortgage that owes something is ticked
      Given "Ticked Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹20,000 on 5 Oct 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens a new Payment from "Ticked Customer"
      Then the Payment is from "Ticked Customer"
      And 2025-Ticked-GoldChain is ticked
      And 2025-Ticked-GoldRing is ticked

    @screen:/payments/new
    Scenario: From a Mortgage, only that one is ticked
      Given "Onlyone Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹20,000 on 5 Oct 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender starts a Payment from "Onlyone Customer" for 2025-Onlyone-GoldRing
      Then 2025-Onlyone-GoldRing is ticked
      And 2025-Onlyone-GoldChain is not ticked

  Rule: A Payment on several Mortgages is split equally, by amount or by percentage

    @screen:/payments/new
    Scenario: Switching between equally, by amount and by percentage
      Given "Split Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹20,000 on 5 Oct 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens a new Payment from "Split Customer"
      And enters ₹4,000 as the Amount received
      Then 2025-Split-GoldChain is allocated ₹2,000
      And 2025-Split-GoldRing is allocated ₹2,000
      # By amount starts from the equal split, and Amount received follows what is typed.
      When the Lender allocates by amount
      Then the Amount for 2025-Split-GoldChain is ₹2,000
      When the Lender sets the Amount for 2025-Split-GoldChain to ₹3,000
      Then the Amount received is ₹5,000
      # Typing Amount received splits it equally again.
      When enters ₹6,000 as the Amount received
      Then the Lender is allocating equally
      And 2025-Split-GoldChain is allocated ₹3,000
      And 2025-Split-GoldRing is allocated ₹3,000
      When the Lender allocates by percentage
      Then the Percentage for 2025-Split-GoldChain is 50
      When the Lender sets the Percentage for 2025-Split-GoldChain to 75
      And the Lender sets the Percentage for 2025-Split-GoldRing to 25
      Then 2025-Split-GoldChain is allocated ₹4,500
      And 2025-Split-GoldRing is allocated ₹1,500

    @screen:/payments/new @screen:/payments/:id/receipt
    Scenario: The confirmation lists each Mortgage, and the Receipt opens once saved
      Given "Confirm Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹20,000 on 5 Oct 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens a new Payment from "Confirm Customer"
      And enters ₹4,000 as the Amount received
      Then the Preview has a section for each of their Mortgages, the first open
      When the Lender saves the Payment
      Then the confirmation asks "Record a Payment of ₹4,000?"
      And the confirmation reads:
        | From                   | Confirm Customer |
        | 2025-Confirm-GoldChain | ₹2,000 cash      |
        | 2025-Confirm-GoldRing  | ₹2,000 cash      |
      When the Lender confirms the Payment
      Then the Receipt page opens

    @screen:/payments/new
    Scenario: Back-dating the Payment reloads each Outstanding and keeps the ticks
      Given "Backdate Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹20,000 on 5 Oct 2025 against a Gold ring
      And was also lent ₹10,000 on 5 Oct 2025 against a Gold coin
      And today is 15 Nov 2025
      When the Lender opens a new Payment from "Backdate Customer"
      And the Lender unticks 2025-Backdate-GoldCoin
      And the Lender dates the Payment 20 Oct 2025
      Then each Outstanding shown is what it owed on 20 Oct 2025
      And 2025-Backdate-GoldChain is ticked
      And 2025-Backdate-GoldRing is ticked
      And 2025-Backdate-GoldCoin is not ticked

  Rule: Paying the full Outstanding Redeems each Mortgage

    @screen:/payments/new @screen:/payments/:id/receipt
    Scenario: Paying the full Outstanding fills each, and asks to Redeem
      Given "Fullpay Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹20,000 on 5 Oct 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens a new Payment from "Fullpay Customer"
      And the Lender pays by UPI
      And enters a Discount of ₹100 for 2025-Fullpay-GoldChain
      And enters an Advance of ₹500 over 2 months for 2025-Fullpay-GoldRing
      And the Lender pays the full Outstanding
      Then each Mortgage's Amount is its whole Outstanding
      And no Discount or Advance is entered
      When the Lender saves the Payment
      Then the confirmation asks "Redeem and hand back the jewellery?"
      And the confirmation reads:
        | 2025-Fullpay-GoldChain | Redeems it |
        | 2025-Fullpay-GoldRing  | Redeems it |
      When the Lender redeems them
      Then the Receipt page opens

    @screen:/payments/new
    Scenario: The full Outstanding can't be paid on a date before a later Payment
      Given "Laterpay Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 10 Nov 2025
      And today is 15 Nov 2025
      When the Lender opens a new Payment from "Laterpay Customer"
      And the Lender dates the Payment 1 Nov 2025
      Then the full Outstanding can't be paid: "There are Payments after that date (latest 10 Nov 2025); close it on or after then"

    @golden @screen:/payments/new
    Scenario: A Dormant Mortgage can be Redeemed, not paid
      Sunil's anklet owes nothing.

      Given today is 15 Nov 2025
      When the Lender opens a new Payment from "Sunil Mehta"
      Then their Mortgage that owes nothing reads "owes nothing: Redeem it" and can't be ticked

  Rule: The form says what is wrong before anything is saved

    @screen:/payments/new
    Scenario: What the form won't record, and why
      Given "Checks Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹20,000 on 5 Oct 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens a new Payment from "Checks Customer"
      # Neither cash nor a Discount yet.
      Then the Payment can't be recorded
      When enters ₹4,000 as the Amount received
      And enters a Discount of minus ₹100 for 2025-Checks-GoldChain
      Then the form says "Amounts cannot be negative."
      And the Payment can't be recorded
      When enters a Discount of ₹0 for 2025-Checks-GoldChain
      And the Lender allocates by percentage
      And the Lender sets the Percentage for 2025-Checks-GoldChain to 60
      And the Lender sets the Percentage for 2025-Checks-GoldRing to 30
      Then the form says "The percentages must add up to 100."
      And the Payment can't be recorded
      When the Lender unticks 2025-Checks-GoldChain
      And the Lender unticks 2025-Checks-GoldRing
      Then the form says "Choose at least one Mortgage."
      And the Payment can't be recorded

    @screen:/payments/new
    Scenario: By percentage, no Mortgage is allocated more than it owes
      Given "Shortfall Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹20,000 on 5 Oct 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens a new Payment from "Shortfall Customer"
      And enters ₹1,00,000 as the Amount received
      And the Lender allocates by percentage
      Then the form says the Allocations add up to what the Mortgages owe, not ₹1,00,000
      And the Payment can't be recorded

  Rule: Cash at or above the Cash Limit is warned of, never refused

    @screen:/payments/new @screen:/payments/:id/receipt
    Scenario: A cash Payment at the Cash Limit asks first
      Given "Cashwarn Customer" was lent ₹60,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      When the Lender opens a new Payment from "Cashwarn Customer"
      And enters ₹20,000 as the Amount received
      And the Lender saves the Payment
      Then the Lender is warned "₹20,000 in cash"
      When the Lender goes back
      Then the Payment is not recorded
      When the Lender saves the Payment
      And the Lender records it in cash anyway
      Then the confirmation asks "Record a Payment of ₹20,000?"
      When the Lender confirms the Payment
      Then the Receipt page opens

    @screen:/payments/new
    Scenario: With the Cash Limit cleared, cash is never warned of
      Given "Nolimit Customer" was lent ₹60,000 on 5 Sept 2025 against a Gold chain
      And the Cash Limit is cleared
      And today is 15 Nov 2025
      When the Lender opens a new Payment from "Nolimit Customer"
      And enters ₹20,000 as the Amount received
      And the Lender saves the Payment
      Then the confirmation asks "Record a Payment of ₹20,000?"

  Rule: The app refuses a Payment it can't take
    The form never offers these; they are asked of the app directly, as any client could.

    Scenario: A Payment dated in the future is refused
      Given "Future Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      Then a Payment of ₹1,000 on it on 16 Nov 2025 is refused: "The Payment date cannot be in the future"

    Scenario: A Payment before the Mortgage started is refused
      Given "Early Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      Then a Payment of ₹1,000 on it on 4 Sept 2025 is refused: "2025-Early-GoldChain had not started on that date"

    Scenario: A Payment to a Mortgage that isn't Active is refused
      Given "Closed Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And it was Redeemed on 10 Nov 2025
      And today is 15 Nov 2025
      Then a Payment of ₹1,000 on it on 15 Nov 2025 is refused: "2025-Closed-GoldChain is redeemed: reopen it first"

    @screen:/payments/new
    Scenario: A Payment of more than the Mortgage owes is refused
      Given "Overpay Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      Then a Payment of ₹1,00,000 on it on 15 Nov 2025 is refused as more than it owed then
      When the Lender opens a new Payment from "Overpay Customer"
      And enters ₹1,00,000 as the Amount received
      Then the Preview says it would be more than it owed on 15 Nov 2025
      And the Payment can't be recorded
