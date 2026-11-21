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
