Feature: Gold Rates, Collateral Value and Loan-to-Value
  A Mortgage's jewellery is valued at the Lender's Gold Rate for its purity, unless the
  Lender sets a Collateral Value by hand; its Loan-to-Value puts it on the Call List when
  too high (above 85%, unless the Lender changes it).

  Gold Rates are one per purity for the whole book, so on the work app each scenario that
  sets one keeps to its own purity (24K, 18K, 14K) and sets only that one, and no other
  scenario's Mortgages are revalued under it. Seeded Mortgages are 22 karat unless given.

  Background:
    Given today is 15 Nov 2025

  @screen:/settings @screen:/mortgages/:id
  Scenario: Saving a Gold Rate revalues the Mortgages of that purity
    Given the 24K Gold Rate is ₹10,000 a gram
    And "Gold Rate Settings Customer" was lent ₹30,000 on 1 Nov 2025 against a Gold coin of 24 karat
    When the Lender opens the Mortgage on 15 Nov 2025
    Then it is valued at the 24K Gold Rate of 15 Nov 2025
    When the Lender opens the Gold Rates in Settings
    And clears every Gold Rate
    Then the Gold Rates cannot be saved
    When the Lender enters ₹12,000 as the 24K Gold Rate
    And saves the Gold Rates
    Then the confirmation lists "24K" at "₹12,000 a gram"
    And the confirmation says "Every Mortgage valued at the Gold Rate is revalued at once."
    When the Lender confirms
    Then the Gold Rates are saved
    When the Lender opens the Mortgage on 15 Nov 2025
    Then its Collateral Value and Loan-to-Value have changed
    And it is valued at the 24K Gold Rate of 15 Nov 2025
    And its Loan-to-Value is shown

  @screen:/mortgages/:id
  Scenario: A Collateral Value set by hand, then the Gold Rate again
    Given the 18K Gold Rate is ₹10,000 a gram
    And "Hand Value Customer" was lent ₹30,000 on 1 Nov 2025 against a Gold chain of 18 karat
    When the Lender opens the Mortgage on 15 Nov 2025
    Then it is valued at the 18K Gold Rate of 15 Nov 2025
    When the Lender starts to set its Collateral Value by hand to ₹30,000
    Then the confirmation shows its Collateral Value and Loan-to-Value now, and ₹30,000 after
    And the confirmation says "Its Loan-to-Value would put it on the Call List."
    When the Lender confirms
    Then its Collateral Value is ₹30,000 set by hand on 15 Nov 2025
    When the Lender starts to use the Gold Rate again
    Then the confirmation says "Its Loan-to-Value would take it off the Call List."
    When the Lender confirms
    Then it is valued at the 18K Gold Rate of 15 Nov 2025

  @screen:/settings @screen:/call-list
  Scenario: A falling Gold Rate puts a Mortgage on the Call List for its Loan-to-Value
    Given the 14K Gold Rate is ₹10,000 a gram
    And "Gold Rate Fall Customer" was lent ₹30,000 on 1 Nov 2025 against a Gold bangle of 14 karat
    When the Lender opens the Call List
    Then it is not on the Call List
    When the Lender sets the 14K Gold Rate to ₹5,000 in Settings
    And the Lender opens the Call List
    Then it is on the Call List for its Loan-to-Value

  # No other @fresh scenario sets a Gold Rate or a Collateral Value: the book has none.
  @fresh @screen:/mortgages/:id @screen:/
  Scenario: Without a Gold Rate a Mortgage has no Collateral Value
    Given "No Gold Rate Customer" was lent ₹30,000 on 1 Nov 2025 against a Gold ring
    When the Lender opens the Mortgage on 15 Nov 2025
    Then it has no Collateral Value, and a hint to set the 22K Gold Rate in Settings
    When the Lender opens the Dashboard
    Then the Dashboard's Collateral Value reads "No Gold Rate or value set yet"

  @screen:/mortgages/:id
  Scenario Outline: A Collateral Value of <value> is refused
    Given "<customer>" was lent ₹30,000 on 1 Nov 2025 against a Gold anklet
    When the Lender opens the Mortgage on 15 Nov 2025
    And the Lender tries to set its Collateral Value by hand to <value>
    Then the Collateral Value is refused and none is set by hand

    Examples:
      | value | customer             |
      | ₹0    | Zero Value Customer  |
      | −₹500 | Below Zero Customer  |

  @golden
  Rule: A closed Mortgage keeps its Collateral Value, but not its Loan-to-Value
    The golden book's 24K and 22K Gold Rates are ₹12,600 and ₹11,550 on 15 Nov 2025.

    @screen:/mortgages/:id
    Scenario Outline: A <closure> Mortgage's Collateral Value cannot be changed
      When the Lender opens <mortgage>
      Then it is valued at the <karat>K Gold Rate of 15 Nov 2025
      And no Loan-to-Value is shown
      And its Collateral Value cannot be changed

      Examples:
        | closure   | mortgage                | karat |
        | Redeemed  | 2025-Vikram-GoldCoin    | 24    |
        | Forfeited | 2025-Rohit-GoldEarrings | 22    |
        | Waived    | 2025-Anita-GoldBracelet | 22    |

    @screen:/mortgages/:id
    Scenario: An Active Mortgage shows its Loan-to-Value and can be set by hand
      When the Lender opens 2025-Ramesh-GoldRing
      Then it is valued at the 22K Gold Rate of 15 Nov 2025
      And its Loan-to-Value is shown
      And its Collateral Value can be set by hand
