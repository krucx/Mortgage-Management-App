Feature: Calculator and Simulation
  The Calculator works out what a loan would come to, exactly as a Mortgage's Ledger would
  be, and saves nothing: an amount, dates and Terms, perhaps planned Payments, a second set
  of Terms to compare, and what the jewellery is worth.

  It needs no Customer to work, so its scenarios run on the work app and read nothing but
  the Default Terms, which each one overrides. Gold Rates are one per purity for the whole
  book, so the scenario that needs one reads the golden book's 22K Gold Rate, and the one
  that needs none runs on the fresh book.

  Background:
    Given today is 15 Nov 2025

  @screen:/calculator
  Scenario: The inputs are kept in the address, and a reload restores them
    When the Lender opens the Calculator
    And the Lender enters ₹80,000 as the amount lent
    And the Lender starts it on 1 Nov 2025
    And the Lender closes it on 1 Feb 2026
    And the Lender enters a Monthly interest rate of 2.5%
    And the Lender plans ₹3,000 a month
    And the Lender compares other Terms at 3% a month
    Then the address keeps the amount, the dates and the rate
    When the Lender reloads the Calculator
    Then the Calculator still holds ₹80,000 lent on 1 Nov 2025, closed on 1 Feb 2026, at 2.5% a month
    And it still compares 3% a month
    And it still plans ₹3,000 a month
    And its tiles show what it comes to

  @screen:/calculator
  Scenario: The tiles show what a loan comes to, and other Terms are compared with them
    When the Lender opens the Calculator
    And the Lender enters ₹50,000 as the amount lent
    And the Lender starts it on 1 Sept 2025
    And the Lender closes it on 1 Mar 2026
    And the Lender enters a Monthly interest rate of 2%
    And the Lender picks "Simple" as its Interest Mode
    Then its tiles show what it comes to
    When the Lender compares other Terms at 3% a month
    Then its tiles show both Terms, and how the second differs from the first
    When the Lender removes the compared Terms
    Then its tiles show what it comes to
    And it compares no other Terms

  @screen:/calculator
  Scenario: Planned Payments pay it off, and a Lump Sum that cannot count says why
    When the Lender opens the Calculator
    And the Lender enters ₹40,000 as the amount lent
    And the Lender starts it on 1 Sept 2025
    And the Lender closes it on 1 Mar 2026
    And the Lender enters a Monthly interest rate of 2%
    And the Lender picks "Simple" as its Interest Mode
    And the Lender plans ₹4,000 a month
    Then its tiles show what it comes to
    And its Paid off tile gives the day it would be paid off
    When the Lender plans a Lump Sum of ₹1,000 on 1 Oct 2025
    And the Lender plans a Lump Sum of ₹1,000 on 1 Aug 2026
    Then its Paid off tile gives the day it would be paid off
    And the Lump Sum on 1 Oct 2025 is counted
    And the Lump Sum on 1 Aug 2026 reads "Ignored: after Closed on"

  @screen:/calculator
  Scenario: A Lump Sum paid after the loan is paid off is ignored
    When the Lender opens the Calculator
    And the Lender enters ₹10,000 as the amount lent
    And the Lender starts it on 1 Sept 2025
    And the Lender closes it on 1 Mar 2026
    And the Lender enters a Monthly interest rate of 2%
    And the Lender picks "Simple" as its Interest Mode
    And the Lender plans ₹6,000 a month
    And the Lender plans a Lump Sum of ₹500 on 15 Feb 2026
    Then the Lump Sum on 15 Feb 2026 reads "Ignored: paid off by then"

  @screen:/calculator
  Scenario: A Lump Sum for more than is owed is refused with what is owed
    When the Lender opens the Calculator
    And the Lender enters ₹20,000 as the amount lent
    And the Lender starts it on 1 Sept 2025
    And the Lender closes it on 1 Mar 2026
    And the Lender enters a Monthly interest rate of 2%
    And the Lender picks "Simple" as its Interest Mode
    And the Lender plans a Lump Sum of ₹50,000 on 1 Oct 2025
    Then the Lump Sum on 1 Oct 2025 is refused with what was owed that day
    And the Calculator says a Lump Sum is more than is owed
    And Lend this is not offered

  @golden @screen:/calculator
  Scenario: The jewellery is valued at the Gold Rate, now and on the closed date
    When the Lender opens the Calculator
    And the Lender enters ₹60,000 as the amount lent
    And the Lender starts it on 15 Nov 2025
    And the Lender closes it on 15 Nov 2026
    And the Lender enters 10 grams of 22K gold as the jewellery
    Then the Calculator values the jewellery at the Gold Rate
    And its Loan-to-Value is shown now and on the closed date

  @fresh @screen:/calculator
  Scenario: Without a Gold Rate the jewellery has no value until one is typed
    When the Lender opens the Calculator
    And the Lender enters ₹60,000 as the amount lent
    And the Lender starts it on 15 Nov 2025
    And the Lender closes it on 15 Nov 2026
    And the Lender enters 10 grams of 22K gold as the jewellery
    Then the Calculator says there is no 22K Gold Rate, so type a Collateral Value instead
    And it shows no Loan-to-Value
    When the Lender types ₹1,20,000 as the Collateral Value
    Then its Loan-to-Value is shown now and on the closed date

  @screen:/calculator
  Scenario: The Graph spans 3 to 36 months, and Month by month lists each month
    When the Lender opens the Calculator
    And the Lender enters ₹50,000 as the amount lent
    And the Lender starts it on 1 Sept 2025
    And the Lender closes it on 1 Sept 2026
    And the Lender enters a Monthly interest rate of 2%
    And the Lender picks "Simple" as its Interest Mode
    And the Lender opens the Graph
    Then the Graph spans 12 months
    When the Lender sets the Graph span to 3 months
    Then the Graph spans 3 months
    When the Lender sets the Graph span to 36 months
    Then the Graph spans 36 months
    When the Lender opens Month by month
    Then Month by month lists each month it worked out

  @screen:/calculator
  Scenario: Inputs that cannot be worked out are marked, and nothing is worked out
    When the Lender opens the Calculator
    Then the Calculator asks for an amount
    When the Lender enters ₹0 as the amount lent
    Then the "Amount lent (₹)" field says "Enter an amount over ₹0"
    And the Calculator asks for the marked inputs to be fixed
    And Lend this is not offered
    When the Lender enters ₹10,000 as the amount lent
    And the Lender starts it on 1 Sept 2025
    And the Lender closes it on 1 Sept 2025
    Then the "Closed on" field says "Closed on must be after the start date"
    When the Lender closes it on 2 Sept 2036
    Then the "Closed on" field says "Closed on must be at most 10 years after the start date"
    When the Lender closes it on 1 Sept 2026
    And the Lender enters a Monthly interest rate of 0%
    Then the "Monthly interest rate (%)" field says "The rate must be over 0% and at most 100% a month"
    When the Lender enters a Monthly interest rate of 2%
    And the Lender plans a Lump Sum of ₹0 on 1 Aug 2025
    Then Lump Sum 1 says "Enter an amount over ₹0"
    And Lump Sum 1 says "Must be on or after the start date"
    When the Lender plans ₹0 a month
    Then the "Monthly payment (₹)" field says "Enter an amount over ₹0"

  @screen:/calculator @screen:/mortgages/new
  Scenario: Lend this opens New Mortgage with the amount, the start date and the Terms
    Given "Calculator Lend Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    When the Lender works out ₹80,000 from 1 Nov 2025 at 3% a month on the Calculator
    Then Lend this is offered
    When lends this
    And chooses the Customer "Calculator Lend Customer"
    Then the new Mortgage form starts from ₹80,000 on 1 Nov 2025 at 3% a month

  @screen:/calculator
  Scenario: Lend this is not offered for a start date still to come
    When the Lender works out ₹80,000 from 1 Dec 2025 at 3% a month on the Calculator
    Then Lend this is not offered
    And the Calculator says it can't lend before the start date
