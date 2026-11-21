Feature: Term Changes
  A Term Change gives a Mortgage new Terms for its months from one of its Accrual Dates,
  today or later; interest already charged never changes. One that has not taken effect
  yet can be removed.

  @screen:/mortgages/:id @screen:/mortgages/:id/terms
  Scenario: Changing the Terms from a coming Accrual Date
    Given "Change Terms Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    When the Lender opens the Mortgage on 5 Nov 2025
    And the Lender starts to change its Terms
    Then the Accrual Dates offered run from "5 Nov 2025 (today)" to "5 Oct 2026"
    And the Terms are set to change from 5 Dec 2025
    And there is no Preview until something differs
    When the Lender sets the rate to 2.5% a month
    Then the Preview shows what changes
    When the Lender saves the Term Change
    Then the confirmation reads:
      | From   | 5 Dec 2025   |
      | Before | 3% a month   |
      | After  | 2.5% a month |
    When the Lender confirms it
    Then its Terms panel lists the Term Change from 5 Dec 2025 to 2.5% a month as coming

  @screen:/mortgages/:id
  Scenario: Removing a coming Term Change after seeing its Preview
    Given "Remove Terms Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold ring
    And on 1 Nov 2025 its Terms were changed to 2% a month from 5 Dec 2025
    When the Lender opens the Mortgage on 15 Nov 2025
    And the Lender starts to remove the Term Change from 5 Dec 2025
    Then the dialog shows what changes
    When the Lender confirms it
    Then its Terms panel lists no Term Change

  @screen:/mortgages/:id
  Scenario: A Term Change in effect cannot be removed
    Given "In Effect Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold bangle
    And on 1 Oct 2025 its Terms were changed to 2% a month from 5 Oct 2025
    When the Lender opens the Mortgage on 15 Nov 2025
    Then its Terms panel lists the Term Change from 5 Oct 2025 to 2% a month, in effect
    And removing the Term Change from 5 Oct 2025 is refused: "This Term Change has taken effect; add another to change the Terms"

  @screen:/mortgages/:id/terms
  Scenario Outline: A Term Change is refused <when>
    Given "<customer>" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And on 1 Nov 2025 its Terms were changed to 2% a month from 5 Dec 2025
    When the Lender opens the Mortgage on 15 Nov 2025
    And the Lender starts to change its Terms
    Then <from> is not offered
    And changing its Terms to 2.5% a month from <from> is refused: "<reason>"

    Examples:
      | when                   | customer             | from        | reason                                                                            |
      | off its Accrual Dates  | Off Date Customer    | 10 Dec 2025 | A Term Change starts on an Accrual Date, today or later (the next is 05 Dec 2025) |
      | for a past date        | Past Date Customer   | 5 Nov 2025  | A Term Change starts on an Accrual Date, today or later (the next is 05 Dec 2025) |
      | for a date taken       | Date Taken Customer  | 5 Dec 2025  | There is already a Term Change on 05 Dec 2025                                     |

  @screen:/mortgages/:id/terms
  Scenario: A Term Change that changes nothing is refused
    The Terms in force from 5 Jan 2026 are the coming Term Change's 2% a month.

    Given "No Change Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
    And on 1 Nov 2025 its Terms were changed to 2% a month from 5 Dec 2025
    When the Lender opens the Mortgage on 15 Nov 2025
    And the Lender starts to change its Terms
    And the Lender picks 5 Jan 2026 and sets the rate to 2% a month
    Then there is no Preview until something differs
    And changing its Terms to 2% a month from 5 Jan 2026 is refused: "The Term Change must change the rate, mode or rule"

  @screen:/mortgages/:id/terms
  Scenario: A lower rate that makes an upcoming Advance Instalment pay Principal warns, and saves
    A part pays unpaid interest, then the Interest to Date, then Principal: at a
    lower rate the ₹1,500 part on 5 Nov 2025 has less interest to pay, so it pays more
    Principal.

    Given "Advance Terms Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold bracelet
    And paid an Advance of ₹3,000 over 2 months on it on 10 Sept 2025
    When the Lender opens the Mortgage on 15 Sept 2025
    And the Lender starts to change its Terms
    And the Lender sets the rate to 2% a month
    Then the Preview warns that its Advance Instalment on 5 Nov 2025 would now reduce Principal
    When the Lender saves the Term Change
    And the Lender confirms it
    Then its Terms panel lists the Term Change from 5 Oct 2025 to 2% a month as coming

  @golden @screen:/mortgages/:id
  Scenario: The Terms panel lists a coming Term Change
    Farhan's pendant goes to 1.5% a month from 16 Nov 2025.

    Given today is 15 Nov 2025
    When the Lender opens 2025-Farhan-GoldPendant
    Then its Terms panel lists the Term Change from 16 Nov 2025 to 1.5% a month as coming
