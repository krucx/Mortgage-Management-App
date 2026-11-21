Feature: Customers
  The Lender adds the people who pledge jewellery, then lends to them.

  @fresh @screen:/customers/new @screen:/mortgages/new @screen:/mortgages/:id
  Scenario: A first Customer, with a photo, and a first Mortgage on an empty book
    When the Lender adds a Customer "Blank Slate Customer" with a photo
    And lends them ₹10,000 against a 5 gram piece with 4.5 grams of gold
    Then the new Mortgage's page names "Blank Slate Customer"
