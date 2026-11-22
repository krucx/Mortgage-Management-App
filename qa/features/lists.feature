Feature: Lists
  Every list sorts by its column headings, keeps its sort and filters in the address, comes
  twenty a page and steps back a page when the last row on it goes. The behaviour is shared,
  so it is covered once, on the Customers list.

  Rule: A list's sort and filter are kept in the address

    @screen:/customers @screen:/customers/:id
    Scenario: Sorting by a column, reversing it, and the arrow showing which way
      Given 3 Customers named "Sorted List Customer" and a number
      When the Lender filters the Customers list by "Sorted List Customer"
      Then no column is sorted
      When the Lender sorts the list by "Name"
      Then the list is sorted by "Name", ascending, with the arrow ▲
      And the first Customer listed is "Sorted List Customer 1"
      When sorts it the other way
      Then the list is sorted by "Name", descending, with the arrow ▼
      And the first Customer listed is "Sorted List Customer 3"
      When the Lender sorts the list by "Address"
      Then the list is sorted by "Address", ascending, with the arrow ▲

    @screen:/customers @screen:/customers/:id
    Scenario: The sort and filter survive a reload and coming Back from a Customer's page
      Given "Kept List Customer" was lent ₹10,000 on 5 Sept 2025 against a Gold ring
      When the Lender opens the Customers list
      And shows only Customers with an Active Mortgage
      And the Lender sorts the list by "Name"
      And sorts it the other way
      Then the address keeps the Active Mortgage filter and the sort "-name"
      When the Lender reloads the page
      Then the list shows only Customers with an Active Mortgage
      And the list is sorted by "Name", descending, with the arrow ▼
      When the Lender opens the first Customer listed
      And the Lender uses the browser's Back button
      Then the list shows only Customers with an Active Mortgage
      And the list is sorted by "Name", descending, with the arrow ▼

  Rule: A list comes twenty a page

    @screen:/customers
    Scenario: The pager's ends are switched off
      Given 21 Customers named "Ends List Customer" and a number
      When the Lender filters the Customers list by "Ends List Customer"
      Then the pager reads "Showing 1–20 of 21"
      And the pager only offers "Next"
      When the Lender goes to the next page
      Then the pager reads "Showing 21–21 of 21"
      And the pager only offers "Previous"

    @screen:/customers
    Scenario: Removing the last row of a page steps back a page
      Given 21 Customers named "Step List Customer" and a number
      When the Lender filters the Customers list by "Step List Customer"
      Then the pager reads "Showing 1–20 of 21"
      When the Lender goes to the next page
      Then 1 Customer is listed
      When the Lender deletes the one Customer on the page
      Then the pager reads "Showing 1–20 of 20"
      And 20 Customers are listed
