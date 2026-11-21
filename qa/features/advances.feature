Feature: Advances
  An Advance pays a Mortgage's interest ahead, in equal parts that land on its coming
  Accrual Dates. The golden book is as of 15 Nov 2025.

  @screen:/payments/new @screen:/mortgages/:id
  Scenario: Recording an Advance previews its parts and holds it on the Mortgage
    Ramesh's 2025-Ramesh-GoldChain has had both parts of its earlier Advance applied.

    Given today is 15 Nov 2025
    When the Lender starts a Payment from "Ramesh Kumar" for 2025-Ramesh-GoldChain
    And enters ₹3,000 as the Amount received
    Then 2025-Ramesh-GoldChain is allocated ₹3,000
    When the Lender clears the Amount received
    And enters an Advance of ₹1,500 over 3 months for 2025-Ramesh-GoldChain
    Then the Amount received is ₹1,500
    And the preview shows "Advance on 2025-Ramesh-GoldChain: ₹1,500 over 3 months" in parts of ₹500 on:
      | 5 Dec 2025 |
      | 5 Jan 2026 |
      | 5 Feb 2026 |
    When the Lender records the Payment
    And the Lender opens 2025-Ramesh-GoldChain
    Then it holds an Advance of ₹1,500
    And its part on 5 Feb 2026 of ₹500 is Upcoming

  @screen:/mortgages/:id
  Scenario: Advance parts land on their Accrual Dates as the clock moves
    Its own Mortgage: golden-book Mortgages gain later Payments from other scenarios, which
    a view as of an earlier day would still count.

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

  @mode:serial
  Rule: An upcoming part can be cancelled
    Ramesh's 2025-Ramesh-GoldRing holds a ₹15,000 Advance over 3 months: the 5 Oct part
    cancelled, 5 Nov applied, 5 Dec upcoming. The last scenario cancels the 5 Dec part, so
    these run in order.

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

    Scenario: Cancelling a part applies it today and gives it its own Receipt
      When the Lender cancels the part on 5 Dec 2025
      Then its parts are:
        | due        | amount | status                   |
        | 5 Dec 2025 | ₹5,000 | Cancelled on 15 Nov 2025 |
      And it holds an Advance of ₹0
      And the page shows the Receipt for the part due 5 Dec 2025
