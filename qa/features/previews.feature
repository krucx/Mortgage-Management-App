Feature: Previews
  A form that changes a Mortgage shows its Preview before anything is saved: what it owes
  today and over the next 12 months, before and after, and the Ledger steps that change,
  in a section of its own for each Mortgage the change touches.

  @screen:/mortgages/:id/terms
  Scenario: The Preview of a change to one Mortgage
    Given "Preview Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    When the Lender opens the Mortgage on 15 Nov 2025
    And the Lender starts to change its Terms
    And the Lender sets the rate to 2% a month
    Then the Preview shows it owes today what its page shows, before and after
    And the Preview shows the interest over the next 12 months, before and after
    And the Preview shows what is outstanding in 3, 6 and 12 months, now and after the change
    And the Preview shows no change to the Ledger so far

  @screen:/payments/new
  Scenario: A Payment on two Mortgages previews each in a section of its own
    Given "Two Pieces Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And was also lent ₹20,000 on 5 Oct 2025 against a Gold ring
    And today is 15 Nov 2025
    When the Lender opens a new Payment from "Two Pieces Customer"
    And enters ₹4,000 as the Amount received
    Then the Preview has a section for each of their Mortgages, the first open
    And each section shows what that Mortgage owes today, before and after
    And each section lists the Payment on 15 Nov 2025 as a Ledger step added
