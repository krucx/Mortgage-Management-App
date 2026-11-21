Feature: Advances
  An Advance pays a Mortgage's interest ahead, in equal parts that land on its coming
  Accrual Dates.

  @screen:/payments/new @screen:/mortgages/:id
  Scenario: Recording an Advance previews its parts and holds it on the Mortgage
    Given "Advance Form Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And today is 15 Nov 2025
    When the Lender starts a Payment from "Advance Form Customer" for 2025-Advance-GoldChain
    And enters ₹3,000 as the Amount received
    Then 2025-Advance-GoldChain is allocated ₹3,000
    When the Lender clears the Amount received
    And enters an Advance of ₹1,500 over 3 months for 2025-Advance-GoldChain
    Then the Amount received is ₹1,500
    And the preview shows "Advance on 2025-Advance-GoldChain: ₹1,500 over 3 months" in parts of ₹500 on:
      | 5 Dec 2025 |
      | 5 Jan 2026 |
      | 5 Feb 2026 |
    When the Lender records the Payment
    And the Lender opens 2025-Advance-GoldChain
    Then it holds an Advance of ₹1,500
    And its part on 5 Feb 2026 of ₹500 is Upcoming

  @screen:/mortgages/:id
  Scenario: Advance parts land on their Accrual Dates as the clock moves
    Given "Time Travel Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold bracelet
    And paid an Advance of ₹6,000 over 2 months on it on 10 Sept 2025
    When the Lender opens the Mortgage on 1 Oct 2025
    Then it holds an Advance of ₹6,000
    And its Ledger lists Advance Instalment 1 of 2 due 5 Oct 2025 as Upcoming
    And its parts are:
      | due        | amount | status   |
      | 5 Oct 2025 | ₹3,000 | Upcoming |
      | 5 Nov 2025 | ₹3,000 | Upcoming |
    When the Lender opens the Mortgage on 5 Oct 2025
    Then it holds an Advance of ₹3,000
    And its part on 5 Oct 2025 of ₹3,000 is Applied
    And its Ledger shows Advance Instalment 1 of 2 on 5 Oct 2025
    When the Lender opens the Mortgage on 6 Nov 2025
    Then it holds an Advance of ₹0
    And its part on 5 Nov 2025 of ₹3,000 is Applied
    And its Ledger shows Advance Instalment 2 of 2 on 5 Nov 2025

  @screen:/mortgages/:id
  Scenario: Cancelling an upcoming part applies it today and gives it its own Receipt
    Given "Cancel Part Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold ring
    And paid an Advance of ₹6,000 over 2 months on it on 10 Sept 2025
    When the Lender opens the Mortgage on 15 Oct 2025
    And the Lender cancels the part on 5 Nov 2025
    Then its parts are:
      | due        | amount | status                   |
      | 5 Nov 2025 | ₹3,000 | Cancelled on 15 Oct 2025 |
    And it holds an Advance of ₹0
    And the page shows the Receipt for the part due 5 Nov 2025

  @screen:/payments/new
  Scenario: Fill sets the Advance to the months' interest, and Amount received follows
    Given "Fill Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And today is 10 Sept 2025
    When the Lender starts a Payment from "Fill Customer" for 2025-Fill-GoldChain
    And picks 4 months for 2025-Fill-GoldChain
    And fills the Advance for 2025-Fill-GoldChain
    Then the Advance for 2025-Fill-GoldChain is 4 months' interest
    And the Amount received is the Advance for 2025-Fill-GoldChain

  @screen:/payments/new
  Scenario Outline: The schedule judges each part against its month's interest
    Given "<customer> Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And today is 10 Sept 2025
    When the Lender starts a Payment from "<customer> Customer" for 2025-<customer>-GoldChain
    And enters an Advance of <advance> over <months> months for 2025-<customer>-GoldChain
    Then the schedule for 2025-<customer>-GoldChain reads "<verdict>"

    Examples:
      | customer | advance | months | verdict                                          |
      | Exact    | ₹2,700  | 3      | Each part pays exactly its month's interest.     |
      | Reduces  | ₹6,000  | 2      | parts would reduce Principal by                  |
      | Short    | ₹1,500  | 3      | The parts fall short of the interest:            |

  @screen:/payments/new
  Scenario: The unpaid interest can be paid alongside an Advance
    Given "Unpaid Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And today is 15 Nov 2025
    When the Lender starts a Payment from "Unpaid Customer" for 2025-Unpaid-GoldChain
    And enters an Advance of ₹1,500 over 3 months for 2025-Unpaid-GoldChain
    And the Lender pays the unpaid interest of 2025-Unpaid-GoldChain
    Then the Amount for 2025-Unpaid-GoldChain is its unpaid interest
    And the Amount received is its unpaid interest and the Advance of ₹1,500

  @screen:/payments/new @screen:/mortgages/:id
  Scenario: Advances on two Mortgages in one Payment, over different months
    Given "Pair Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And was also lent ₹20,000 on 5 Sept 2025 against a Gold ring
    And today is 10 Sept 2025
    When the Lender opens a new Payment from "Pair Customer"
    And enters an Advance of ₹900 over 2 months for 2025-Pair-GoldChain
    And enters an Advance of ₹600 over 3 months for 2025-Pair-GoldRing
    Then the Amount received is ₹1,500
    And the preview shows "Advance on 2025-Pair-GoldChain: ₹900 over 2 months" in parts of ₹450 on:
      | 5 Oct 2025 |
      | 5 Nov 2025 |
    And the preview shows "Advance on 2025-Pair-GoldRing: ₹600 over 3 months" in parts of ₹200 on:
      | 5 Oct 2025 |
      | 5 Nov 2025 |
      | 5 Dec 2025 |
    When the Lender records the Payment
    And the Lender opens 2025-Pair-GoldChain
    Then it holds an Advance of ₹900
    When the Lender opens 2025-Pair-GoldRing
    Then it holds an Advance of ₹600

  @screen:/payments/new
  Scenario: A Mortgage paid in full in the Payment can't hold an Advance
    Given "Redeemfull Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And today is 10 Sept 2025
    When the Lender starts a Payment from "Redeemfull Customer" for 2025-Redeemfull-GoldChain
    And the Lender pays the full Outstanding
    Then the Advance for 2025-Redeemfull-GoldChain can't be entered: "Paid in full here, so Redeemed: no Advance"
    And a Payment paying the whole of it with an Advance of ₹500 is refused: "This Payment Redeems it, so it can't hold an Advance"

  @screen:/payments/new
  Scenario: An Advance entered before paying in full is listed as a problem
    Given "Redeemlate Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And today is 10 Sept 2025
    When the Lender starts a Payment from "Redeemlate Customer" for 2025-Redeemlate-GoldChain
    And enters an Advance of ₹500 over 2 months for 2025-Redeemlate-GoldChain
    And the Lender allocates by amount
    And the Lender sets the Amount for 2025-Redeemlate-GoldChain to what pays it in full
    Then the form lists the problem "2025-Redeemlate-GoldChain is paid in full here, so it is Redeemed and can't hold an Advance."
    And the Payment can't be recorded

  @screen:/payments/new
  Scenario: Advances adding up to more than Amount received can't be recorded
    Given "Overadvance Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And today is 10 Sept 2025
    When the Lender starts a Payment from "Overadvance Customer" for 2025-Overadvance-GoldChain
    And enters an Advance of ₹2,000 over 2 months for 2025-Overadvance-GoldChain
    And enters ₹1,000 as the Amount received
    Then the form lists the problem "The Advances add up to more than Amount received."
    And the Payment can't be recorded

  @screen:/mortgages/:id @screen:/customers/:id
  Scenario: The Advances panel groups the parts by Payment, and the Customer page totals them
    Given "Grouped Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And paid an Advance of ₹3,000 over 2 months on it on 10 Sept 2025
    And paid an Advance of ₹1,800 over 3 months on it on 11 Sept 2025
    When the Lender opens the Mortgage on 12 Sept 2025
    Then it holds an Advance of ₹4,800
    And its Advance received 10 Sept 2025 is ₹3,000 over 2 months
    And its Advance received 11 Sept 2025 is ₹1,800 over 3 months
    When the Lender opens the Customer "Grouped Customer"
    Then their Advance held is the total their Mortgages hold

  @screen:/mortgages/:id @screen:/payments/:id/advance-instalments/:instalment/receipt
  Scenario: Keeping an upcoming part leaves it, and a cancelled part's Receipt can be reopened and printed
    Given "Keep Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold ring
    And paid an Advance of ₹6,000 over 2 months on it on 10 Sept 2025
    When the Lender opens the Mortgage on 15 Oct 2025
    And the Lender starts to cancel the part on 5 Nov 2025
    And the Lender keeps it
    Then its part on 5 Nov 2025 of ₹3,000 is Upcoming
    When the Lender cancels the part on 5 Nov 2025
    And the Lender opens the Mortgage on 20 Oct 2025
    And the Lender opens the Receipt for the part due 5 Nov 2025
    Then the page shows the Receipt for the part due 5 Nov 2025
    When the Lender prints the Receipt for the part
    Then the printable Receipt says "Advance applied"

  @screen:/mortgages/:id
  Scenario: An applied or cancelled part can't be cancelled
    Given "Refuse Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold bracelet
    And paid an Advance of ₹9,000 over 3 months on it on 10 Sept 2025
    And its part due 5 Dec 2025 was cancelled on 15 Oct 2025
    When the Lender opens the Mortgage on 20 Oct 2025
    Then its parts are:
      | due        | amount | status                   |
      | 5 Oct 2025 | ₹3,000 | Applied                  |
      | 5 Nov 2025 | ₹3,000 | Upcoming                 |
      | 5 Dec 2025 | ₹3,000 | Cancelled on 15 Oct 2025 |
    And cancelling the part due 5 Oct 2025 is refused: "This Advance Instalment has been applied"
    And cancelling the part due 5 Dec 2025 is refused: "This Advance Instalment was cancelled on 15 Oct 2025"

  @screen:/payments/new
  Scenario: A later Payment that would leave the parts holding more than owed is refused
    Given "Overheld Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And paid an Advance of ₹6,000 over 2 months on it on 10 Sept 2025
    And today is 15 Sept 2025
    When the Lender starts a Payment from "Overheld Customer" for 2025-Overheld-GoldChain
    And enters ₹26,000 as the Amount received
    Then the Preview refuses it, saying "cancel the Advance Instalments on 05 Nov 2025 first"
    And a Payment of ₹26,000 on it on 15 Sept 2025 is refused, saying "its upcoming Advance Instalments holding ₹6,000"

  @screen:/mortgages/:id @screen:/payments/:id
  Scenario: Voiding a Payment removes all its Advance Instalments, applied or not
    Given "Voidparts Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And paid an Advance of ₹6,000 over 2 months on it on 10 Sept 2025
    When the Lender opens the Mortgage on 20 Oct 2025
    Then its Ledger shows Advance Instalment 1 of 2 on 5 Oct 2025
    And its Ledger lists Advance Instalment 2 of 2 due 5 Nov 2025 as Upcoming
    When the Lender opens that Payment
    And the Lender voids it because "Entered in error"
    And the Lender opens the Mortgage on 20 Oct 2025
    Then it holds no Advance
    And its Ledger shows no Advance Instalment

  @golden
  Rule: The Advances panel shows each part
    Ramesh's 2025-Ramesh-GoldRing holds a ₹15,000 Advance over 3 months: the 5 Oct part
    cancelled, 5 Nov applied, 5 Dec upcoming.

    Background:
      Given today is 15 Nov 2025
      And the Lender opens 2025-Ramesh-GoldRing

    @screen:/mortgages/:id
    Scenario: The Advances panel shows the Advance held and each part
      Then it holds an Advance of ₹5,000
      And its parts are:
        | due        | amount | status                    |
        | 5 Oct 2025 | ₹5,000 | Cancelled on 20 Sept 2025 |
        | 5 Nov 2025 | ₹5,000 | Applied                   |
        | 5 Dec 2025 | ₹5,000 | Upcoming                  |

    Scenario: The cancel dialog closes with Esc, a click outside and its ×
      When the Lender starts to cancel the part on 5 Dec 2025
      And presses Esc
      Then the dialog is closed
      When the Lender starts to cancel the part on 5 Dec 2025
      And clicks outside the dialog
      Then the dialog is closed
      When the Lender starts to cancel the part on 5 Dec 2025
      And closes the dialog with its ×
      Then the dialog is closed
      And its part on 5 Dec 2025 of ₹5,000 is Upcoming
