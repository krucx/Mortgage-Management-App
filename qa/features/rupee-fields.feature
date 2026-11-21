Feature: Rupee amount fields
  A rupee amount moves by whole rupees when the Lender presses its arrows or scrolls over
  it, and an amount with paise can still be typed: stepping keeps the paise.

  Scenario Outline: <field> on <screen> steps by whole rupees from an amount with paise
    Given "<customer>" was lent ₹98,76,543 on 5 Sept 2025 against a Gold chain
    And today is 15 Nov 2025
    When the Lender finds the rupee field "<field>" on <screen>
    And types 1500.50 into it
    Then the rupee field holds 1500.50 and is valid
    When the Lender presses its up arrow
    Then the rupee field holds 1501.50 and is valid
    When the Lender scrolls down over it twice
    Then the rupee field holds 1499.50 and is valid

    @screen:/mortgages/new
    Examples: New Mortgage
      | field          | screen           | customer     |
      | Principal lent | the New Mortgage | Anvita Rupee |

    @screen:/mortgages/:id/edit
    Examples: Edit Mortgage
      | field          | screen            | customer     |
      | Principal lent | the Edit Mortgage | Bhavik Rupee |

    @screen:/mortgages/:id
    Examples: The Mortgage
      | field            | screen       | customer     |
      | Collateral Value | the Mortgage | Charvi Rupee |
      | Received now     | the Mortgage | Daksh Rupee  |
      | Recovered Amount | the Mortgage | Eshan Rupee  |

    @screen:/closures
    Examples: Closures
      | field            | screen            | customer      |
      | Received now     | the Closures page | Falguni Rupee |
      | Recovered Amount | the Closures page | Gaurik Rupee  |
