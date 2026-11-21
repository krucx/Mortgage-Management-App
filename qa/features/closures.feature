Feature: Closures
  A Mortgage is closed by a Redemption, and a closed one can be reopened.

  @screen:/mortgages/:id
  Scenario: A Redemption uses the upcoming Advance, and Reopen restores it
    Meera's 2025-Meera-GoldNecklace has no Advance in the golden book; this gives it one.

    Given today is 15 Nov 2025
    And "Meera Sharma" has paid an Advance of ₹2,000 over 2 months on 2025-Meera-GoldNecklace
    When the Lender opens 2025-Meera-GoldNecklace
    Then it holds an Advance of ₹2,000
    When the Lender starts to redeem it
    Then the Redemption takes off the ₹2,000 Advance held
    # UPI: the final Payment is over the cash limit.
    When the Lender redeems it with a final Payment by UPI
    Then its Closure reads "Redeemed on 15 Nov 2025"
    And its Closure reads "₹2,000 of it from the Advance held"
    When the Lender reopens it because "Redeemed by mistake"
    Then it is Active
    And it holds an Advance of ₹2,000
    And its parts are:
      | due        | amount | status   |
      | 5 Dec 2025 | ₹1,000 | Upcoming |
      | 5 Jan 2026 | ₹1,000 | Upcoming |
