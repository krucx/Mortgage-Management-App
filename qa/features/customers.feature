Feature: Customers
  The Lender adds the people who pledge jewellery, then lends to them. A Customer's Contact
  number 1 is their Primary Number: no two people share one.

  # In order, on the one empty book: the list is empty until the first Customer is added.
  @fresh @mode:serial
  Rule: An empty book

    @screen:/customers
    Scenario: The Customers list of an empty book
      When the Lender opens the Customers list
      Then the list says "No Customers yet."

    @screen:/customers/new @screen:/mortgages/new @screen:/mortgages/:id
    Scenario: A first Customer, with a photo, and a first Mortgage on an empty book
      When the Lender adds a Customer "Blank Slate Customer" with a photo
      And lends them ₹10,000 against a 5 gram piece with 4.5 grams of gold
      Then the new Mortgage's page names "Blank Slate Customer"

  @golden
  Rule: The Customers list finds people by name or phone
    The golden book's ten Customers; Gopal Rao, a Standalone Referrer, introduced Deepa Nair.

    @screen:/customers
    Scenario: Filtering by name lists the Customers and the Matching Referrers
      When the Lender filters the Customers list by "Rao"
      Then the Customers listed are:
        | Kiran Rao |
      And the Matching Referrers are:
        | Gopal Rao |

    @screen:/customers
    Scenario: Filtering by phone matches part of a number
      When the Lender filters the Customers list by "98111"
      Then the Customers listed are:
        | Ramesh Kumar |
        | Sunil Mehta  |
      And no Matching Referrers are shown
      When the Lender filters the Customers list by "9899900011"
      Then the list says "No Customers match."
      And the Matching Referrers are:
        | Gopal Rao |

    @screen:/customers
    Scenario: Only Customers with an Active Mortgage
      Vikram's coin was Redeemed, Rohit's earrings Forfeited and Anita's bracelet Waived off;
      Priya's bangles were Reopened.

      When the Lender opens the Customers list
      And shows only Customers with an Active Mortgage
      Then the Customers listed are:
        | Deepa Nair   |
        | Farhan Ali   |
        | Kiran Rao    |
        | Meera Sharma |
        | Priya Sharma |
        | Ramesh Kumar |
        | Sunil Mehta  |
      When the Lender filters the Customers list by "Vikram"
      Then the list says "No Customers match."

    @screen:/customers
    Scenario: Sorting by a column, then the other way
      When the Lender opens the Customers list
      And the Lender sorts the list by "Contact numbers"
      Then the first Customer listed is "Kiran Rao"
      When sorts it the other way
      Then the first Customer listed is "Deepa Nair"

  Rule: The list a page at a time, and deleting from it

    @screen:/customers
    Scenario: The Customers list comes 20 at a time
      Given 21 Customers named "Pager Customer" and a number
      When the Lender filters the Customers list by "Pager Customer"
      Then the pager reads "Showing 1–20 of 21"
      When the Lender goes to the next page
      Then the pager reads "Showing 21–21 of 21"
      And 1 Customer is listed

    @screen:/customers
    Scenario: A Customer with Mortgages cannot be deleted
      Given "Delete Refused Customer" was lent ₹10,000 on 5 Sept 2025 against a Gold ring
      When the Lender starts to delete "Delete Refused Customer" from the Customers list
      Then the list says "A Customer with Mortgages cannot be deleted"
      And the dialog is closed
      And the Customers listed are:
        | Delete Refused Customer |

    @screen:/customers @screen:/customers/:id
    Scenario: Deleting a Customer clears the Referrer of the people they referred
      Given "Delete Me Customer" is a Customer who referred "Delete Me Friend"
      When the Lender starts to delete "Delete Me Customer" from the Customers list
      Then the dialog says "Delete Me Customer referred Delete Me Friend. Their Referrer will be cleared."
      When the Lender confirms the delete
      Then the list says "No Customers match."
      When the Lender opens the Customer "Delete Me Friend"
      Then they were referred by nobody

  Rule: Adding and editing a Customer

    @screen:/customers/new @screen:/mortgages/new @screen:/customers/:id
    Scenario: The confirm lists every detail, then the Lender goes on to lend to them
      When the Lender starts a new Customer "Full Details Customer" to lend to
      And enters their details:
        | Address          | 4 Summary Street |
        | Contact number 1 | 7045100001       |
        | Contact number 2 | 7045100002       |
        | Email            | full@example.com |
        | Aadhaar Number   | 1234 5678 9012   |
        | PAN              | abcde1234f       |
      And adds their photo, Aadhaar card photo and PAN card photo
      And the Lender saves the Customer
      Then the confirm lists:
        | Name            | Full Details Customer  |
        | Address         | 4 Summary Street       |
        | Contact numbers | 7045100001, 7045100002 |
        | Referrer        | —                      |
        | Photo           | New photo              |
        | Email           | full@example.com       |
        | Aadhaar Number  | XXXX XXXX 9012         |
        | PAN             | ABCDE1234F             |
        | ID Photos       | Aadhaar new · PAN new  |
      When the Lender confirms
      Then the New Mortgage form is for "Full Details Customer"
      When the Lender opens the Customer "Full Details Customer"
      Then their page shows:
        | Address         | 4 Summary Street       |
        | Contact numbers | 7045100001, 7045100002 |
        | Referred by     | —                      |
        | Email           | full@example.com       |
        | Aadhaar Number  | XXXX XXXX 9012         |
        | PAN             | ABCDE1234F             |
      And their ID Photos show the Aadhaar card and the PAN card
      And no more than the last 4 digits of "1234 5678 9012" left the form

    @screen:/customers/new @screen:/customers/:id
    Scenario Outline: An Aadhaar Number typed <as> keeps only its last 4 digits
      When the Lender adds a Customer "<name>" with the Aadhaar Number "<typed>"
      Then their page shows:
        | Aadhaar Number | XXXX XXXX 9012 |
      And no more than the last 4 digits of "<typed>" left the form

      Examples:
        | as        | name                    | typed          |
        | whole     | Aadhaar Whole Customer  | 1234 5678 9012 |
        | masked    | Aadhaar Masked Customer | XXXX XXXX 9012 |
        | as 4 only | Aadhaar Last4 Customer  | 9012           |

    @screen:/customers/new
    Scenario: Another Customer's Contact number 1 is refused before saving
      Given "Number Owner Customer" is a Customer
      When the Lender starts a new Customer "Number Taker Customer"
      And enters the Contact number 1 of "Number Owner Customer"
      Then Contact number 1 says "Already belongs to Customer Number Owner Customer"
      And the Customer cannot be saved

    @screen:/customers/new @screen:/customers/:id
    Scenario: A Contact number 2 another Customer uses is only a warning
      Given "Family Phone Customer" is a Customer
      When the Lender starts a new Customer "Family Member Customer"
      And enters the Contact number 1 of "Family Phone Customer" as their Contact number 2
      Then Contact number 2 warns "Also used by Family Phone Customer"
      When the Lender saves the Customer and confirms
      Then the page warns "A contact number is also used by Family Phone Customer"

    @screen:/customers/new @screen:/customers/:id
    Scenario: A photo that failed to upload is sent again, and only it
      Given the PAN card photo fails to upload the first time
      When the Lender starts a new Customer "Retry Photo Customer"
      And adds their photo, Aadhaar card photo and PAN card photo
      And the Lender saves the Customer and confirms
      Then the form says "Customer saved, but a photo failed"
      When the Lender retries the photo upload
      Then their ID Photos show the Aadhaar card and the PAN card
      And the photo and the Aadhaar card photo were sent once, and the PAN card photo twice

    @screen:/customers/:id @screen:/customers/:id/edit
    Scenario: Editing a Customer is kept in their History
      Given "Edit Customer" is a Customer
      When the Lender edits "Edit Customer" with:
        | Address | 9 Changed Road   |
        | Email   | edit@example.com |
      Then their page shows:
        | Address | 9 Changed Road   |
        | Email   | edit@example.com |
      And their latest History entry is "Customer edited", with:
        | Address 1 Test Street → 9 Changed Road |
        | Email (none) → edit@example.com        |

  @golden
  Rule: A Customer's page

    @screen:/customers/:id
    Scenario: A Customer's page shows the Advance their Mortgages hold, and those Mortgages
      When the Lender opens the Customer "Ramesh Kumar"
      Then their Advance held is the total their Mortgages hold
      And their Active Mortgages are:
        | 2025-Ramesh-GoldChain |
        | 2025-Ramesh-GoldRing  |
      And they have no Closed Mortgages

    @screen:/customers/:id
    Scenario: Closed Mortgages are tucked away below the Active ones
      When the Lender opens the Customer "Vikram Singh"
      Then they have no Active Mortgages
      And their Closed Mortgages are:
        | 2025-Vikram-GoldCoin |

  Rule: The backend refuses details that cannot stand, whatever sends them

    Scenario Outline: A new Customer with a bad <detail> is refused
      When a new Customer is sent with "<value>" as their <detail>
      Then it is refused: "<reason>"

      Examples:
        | detail           | value        | reason                                                    |
        | Contact number 1 | 12345        | must be a 10-digit mobile number                          |
        | Name             |              | must not be empty                                         |
        | Email            | not-an-email | Not an email address                                      |
        | Aadhaar Number   | 12345        | An Aadhaar Number is its last 4 digits (or all 12)        |
        | PAN              | ABCD1234     | A PAN is 5 letters, 4 digits and a letter, e.g. ABCDE1234F |

    Scenario: A PAN already another Customer's is refused
      Given "PAN Holder Customer" is a Customer with the PAN "KLMNO1234P"
      When a new Customer is sent with "klmno1234p" as their PAN
      Then it is refused: "PAN KLMNO1234P already belongs to Customer PAN Holder Customer"

    Scenario: A Customer cannot be their own Referrer
      Given "Own Referrer Customer" is a Customer
      When "Own Referrer Customer" is sent as their own Referrer
      Then it is refused: "A Customer cannot be their own Referrer"
