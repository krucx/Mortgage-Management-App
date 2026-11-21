Feature: Receipts and Voids
  Every Payment has a Receipt for the Customer; a voided one stays on record without it.

  Background:
    Given today is 15 Nov 2025

  @golden @screen:/payments/:id @screen:/payments/:id/receipt
  Scenario: A Payment's Receipt names the jewellery, not the Mortgage
    Ramesh's ₹15,000 UPI Advance on his gold ring, received 10 Sept 2025.

    When the Lender opens the Payment "UPI advance Ramesh"
    Then its Receipt is addressed to "Ramesh Kumar" and names the "Gold ring"
    And its Receipt does not name 2025-Ramesh-GoldRing
    When the Lender prints the Receipt
    Then the printable Receipt lists:
      | ₹5,000 on 5 Oct 2025 |
      | ₹5,000 on 5 Nov 2025 |
      | ₹5,000 on 5 Dec 2025 |

  @screen:/payments/:id
  Scenario: A voided Payment stays on record with its reason and no Receipt
    Given "Void Customer" was lent ₹40,000 on 5 Sept 2025 against a Gold bangle
    And paid ₹1,000 on it on 15 Nov 2025
    When the Lender opens that Payment
    Then it has a Receipt
    When the Lender voids it because "Entered twice"
    Then it shows "Payment of ₹1,000 voided" with the reason "Entered twice"
    And it has no Receipt and cannot be voided again
