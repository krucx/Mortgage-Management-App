Feature: Referrers
  A Referrer introduced a Customer to the Lender: another Customer, or a Standalone Referrer
  known only by name, address and phone.

  @screen:/customers/new @screen:/customers/:id
  Scenario: An existing Customer picked as the Referrer
    Given "Picked Referrer Customer" is a Customer
    When the Lender starts a new Customer "Picked Referral Customer"
    And picks "Picked Referrer Customer" as their Referrer
    And the Lender saves the Customer
    Then the confirmation reads:
      | Referrer | Picked Referrer Customer |
    When the Lender confirms
    Then they were referred by "Picked Referrer Customer"
    When the Lender opens their Referrer
    Then the Customers they referred are:
      | Picked Referral Customer |

  @screen:/customers/new @screen:/customers/:id @screen:/referrers/:id
  Scenario: A New Referrer is added with the Customer
    When the Lender starts a new Customer "New Referral Customer"
    And adds a New Referrer "Brand New Referrer" with the phone "7045100010"
    And the Lender saves the Customer
    Then the confirmation reads:
      | Referrer | Brand New Referrer (new Referrer, 7045100010) |
    When the Lender confirms
    Then they were referred by the Standalone Referrer "Brand New Referrer"
    When the Lender opens their Referrer
    Then the Referrer page shows "Brand New Referrer" with the phone "7045100010"
    And the Customers they referred are:
      | New Referral Customer |

  @screen:/customers/new @screen:/customers/:id
  Scenario: An Existing person with nobody picked cannot be saved; None can
    When the Lender starts a new Customer "Unpicked Referrer Customer"
    And chooses an Existing person as their Referrer but picks nobody
    Then the form says "Pick the Referrer from the search results"
    And the Customer cannot be saved
    When chooses None as their Referrer
    And the Lender saves the Customer and confirms
    Then they were referred by nobody

  @screen:/customers/new @screen:/customers/:id @screen:/referrers/:id
  Scenario: A Standalone Referrer's number makes them the new Customer, and the people they referred move
    Given "Promoted Referrer" is a Standalone Referrer who referred "Promoted Referrer Friend"
    When the Lender starts a new Customer "Promoted Referrer"
    And enters the phone of the Standalone Referrer "Promoted Referrer"
    Then Contact number 1 warns that it belongs to the Referrer "Promoted Referrer", who becomes this Customer
    When the Lender saves the Customer and confirms
    Then the Customers they referred are:
      | Promoted Referrer Friend |
    When the Lender opens the Customer "Promoted Referrer Friend"
    Then they were referred by "Promoted Referrer"

  @golden @screen:/customers/:id @screen:/referrers/:id
  Scenario: A Standalone Referrer's page shows their details and the people they referred
    When the Lender opens the Customer "Deepa Nair"
    Then they were referred by the Standalone Referrer "Gopal Rao"
    When the Lender opens their Referrer
    Then the Referrer page shows "Gopal Rao" with the phone "9899900011"
    And the Customers they referred are:
      | Deepa Nair |
