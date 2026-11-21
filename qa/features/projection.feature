Feature: Projection
  An Active Mortgage's page shows where it is heading in 3, 6 and 12 months: with no more
  Payments, and what if the Customer pays the same amount on every Accrual Date.

  @screen:/mortgages/:id
  Scenario: What if they pay every month
    Given "Projection Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    When the Lender opens the Mortgage on 15 Nov 2025
    Then its Projection shows in 3, 6 and 12 months what it owes with no more Payments
    And its Projection has no Loan-to-Value until there is a Collateral Value
    When the Lender asks what if they pay ₹2,000 every month
    Then its Projection also shows what it owes paying ₹2,000 a month
    And its Projection gives the day it would be paid off paying ₹2,000 a month
    When the Lender asks what if they pay ₹100 every month
    Then its Projection says it would not be paid off within ten years

  @golden @screen:/mortgages/:id
  Scenario: The Projection shows Loan-to-Value once there is a Collateral Value
    Kiran's kada has a Collateral Value set by hand.

    Given today is 15 Nov 2025
    When the Lender opens 2025-Kiran-GoldKada
    Then its Projection shows in 3, 6 and 12 months what it owes with no more Payments
    And its Projection shows its Loan-to-Value in 3, 6 and 12 months
