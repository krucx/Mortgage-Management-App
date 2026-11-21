Feature: ID Photos
  Photos of a Customer's Aadhaar card (the masked front) and PAN card. The number on a new one
  is read into its field, as a suggestion to check, only when the field is empty. These
  scenarios check that rule, not how well the photos are read: theirs are clear printed text.

  @screen:/customers/new
  Scenario: The number on an ID Photo fills an empty field, until the Lender types over it
    When the Lender starts a new Customer "Read Aadhaar Customer"
    And adds an Aadhaar card photo that reads "XXXX XXXX 4321"
    Then the Aadhaar Number reads "4321", read from the photo
    When types "4329" as the Aadhaar Number
    Then the Aadhaar Number is no longer marked as read from the photo

  @screen:/customers/new
  Scenario: The number on an ID Photo never replaces what was typed
    When the Lender starts a new Customer "Typed PAN Customer"
    And types "ABCDE1234F" as the PAN
    And adds a PAN card photo that reads "PQRST6789Z"
    Then the PAN reads "ABCDE1234F" once the photo is read
