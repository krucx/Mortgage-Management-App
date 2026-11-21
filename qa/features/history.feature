Feature: History
  A Customer's or Mortgage's page lists its latest 5 changes, newest first; the complete History
  pages through all of them. Every kind of change reads the way the Lender would say it, and
  names or links what it was about.

  Rule: A page shows the latest 5 changes, and the complete History pages

    @screen:/customers/:id
    Scenario: A Customer's History pages through every change
      Given "Histpage Customer" is a Customer
      And their address was changed 22 times
      When the Lender opens the Customer "Histpage Customer"
      Then the History shows the latest 5 of 23 changes
      When the Lender shows the complete History
      Then the pager reads "Showing 1–20 of 23"
      And the complete History lists 20 changes
      When the Lender goes to the next page
      Then the pager reads "Showing 21–23 of 23"
      And the complete History lists 3 changes
      And the complete History ends with "Customer created"

  Rule: Each kind of change reads the way the Lender would say it

    @screen:/mortgages/:id @screen:/payments/:id
    Scenario: A Mortgage's History lists its edits, Payments, photos, Term Changes and Advance Instalments
      Given "Histmort Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And its description was changed to "Gold bangle" on 6 Sept 2025
      And a photo of it was added on 7 Sept 2025
      And that photo was removed on 8 Sept 2025
      And paid ₹1,000 on it on 5 Oct 2025, voided because "Entered twice"
      And on 1 Nov 2025 its Terms were changed to 2.5% a month from 5 Dec 2025
      And its Term Change from 5 Dec 2025 was removed on 2 Nov 2025
      And paid an Advance of ₹6,000 over 2 months on it on 5 Nov 2025
      And its part due 5 Jan 2026 was cancelled on 6 Nov 2025
      When the Lender opens 2025-Histmort-GoldChain
      Then the History shows only its latest 5 changes
      When the Lender shows the complete History
      Then its History lists "Mortgage edited: Jewellery Gold chain → Gold bangle"
      And its History lists "Mortgage photo added"
      And its History lists "Mortgage photo removed"
      And its History lists "Payment voided · Entered twice", with "Payment" linked
      And its History lists "Mortgage Term Change added from 5 Dec 2025"
      And its History lists "Mortgage Term Change removed"
      And its History lists "Mortgage Advance Instalment cancelled"

    @screen:/customers/:id @screen:/mortgages/:id
    Scenario: A Customer's History names each Mortgage's Closure and links to it
      Given "Histclose Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And it was Redeemed on 5 Nov 2025
      And it was reopened on 6 Nov 2025 because "Redeemed by mistake"
      And was also lent ₹20,000 on 5 Sept 2025 against a Gold ring
      And it was Waived off on 5 Nov 2025 with ₹0 received
      And was also lent ₹10,000 on 5 Sept 2025 against a Gold bangle
      And it was Forfeited on 5 Nov 2025 recovering ₹5,000
      When the Lender opens the Customer "Histclose Customer"
      And the Lender shows the complete History
      Then its History lists "Mortgage 2025-Histclose-GoldChain Redeemed", with "2025-Histclose-GoldChain" linked
      And its History lists "Mortgage 2025-Histclose-GoldChain reopened", with "2025-Histclose-GoldChain" linked
      And its History lists "Mortgage 2025-Histclose-GoldRing Waived off", with "2025-Histclose-GoldRing" linked
      And its History lists "Mortgage 2025-Histclose-GoldBangle Forfeited", with "2025-Histclose-GoldBangle" linked
