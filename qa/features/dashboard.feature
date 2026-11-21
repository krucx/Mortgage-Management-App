Feature: Dashboard
  The Dashboard is the whole lending book at a glance, worked out afresh whenever it is
  opened, as of the QA date. The book is one for every scenario on an app, so a figure is
  checked against what the app itself works out for the same day, and the golden book, which
  nothing changes, is the one it is read from. Its last day is 15 Nov 2025.

  Rule: The headline is what the Active Mortgages owe
    @golden @screen:/ @screen:/mortgages @screen:/customers
    Scenario: Owed on Active Mortgages and its tiles, each opening the list they were counted from
      When the Lender opens the Dashboard
      Then the Dashboard is as of 15 Nov 2025
      And the Owed headline is the Principal Outstanding and the unpaid interest of the Active Mortgages
      And the tiles show the Principal Outstanding, Unpaid interest, Active Mortgages and Customers with Active Mortgages
      When the Lender follows the Dashboard's Owed headline
      Then the Lender is on "/mortgages"
      When the Lender opens the Dashboard
      And the Lender follows the Dashboard's "Principal Outstanding" figure
      Then the Lender is on "/mortgages"
      When the Lender opens the Dashboard
      And the Lender follows the Dashboard's "Unpaid interest" figure
      Then the Lender is on "/mortgages"
      When the Lender opens the Dashboard
      And the Lender follows the Dashboard's "Active Mortgages" figure
      Then the Lender is on "/mortgages"
      When the Lender opens the Dashboard
      And the Lender follows the Dashboard's "Customers with Active Mortgages" figure
      Then the Lender is on "/customers?active=true"
      And only Customers with an Active Mortgage are listed

  Rule: The activity figures cover a month or a stretch of days the Lender chooses
    It starts as the month of the QA date up to that date. Picking a month fills in its first and last day;
    changing either day makes the stretch the Lender's own.

    @golden @screen:/
    Scenario: The month picker moves the activity to another month
      When the Lender opens the Dashboard
      Then the activity covers 1 Nov 2025 to 15 Nov 2025
      And the activity figures agree with the book
      When the Lender picks Oct 2025 as the activity month
      Then the activity covers 1 Oct 2025 to 31 Oct 2025
      And the activity figures agree with the book

    @golden @screen:/
    Scenario: A custom From and To set the activity, and a To before the From is refused
      When the Lender opens the Dashboard
      And the Lender sets the activity from 15 Sept 2025
      And the Lender sets the activity to 20 Oct 2025
      Then the activity covers 15 Sept 2025 to 20 Oct 2025
      And the activity figures agree with the book
      When the Lender sets the activity to 14 Sept 2025
      Then the Dashboard says "End date must be on or after start date."
      When the Lender sets the activity to 30 Nov 2025
      Then the activity covers 15 Sept 2025 to 30 Nov 2025
      And the Dashboard has no date error

  Rule: Interest collected this month and this year open the Payments they were counted from
    The year's tile counts to the QA date, and the Payments list's summary for a year counts to
    the end of it, so only the month's figure is held to the list's.

    @golden @screen:/ @screen:/payments
    Scenario: Interest collected in the month opens the Payments received then
      When the Lender opens the Dashboard
      Then the Interest collected tiles agree with the book
      When the Lender follows the Dashboard's "In Nov 2025" figure
      Then the Lender is on "/payments?month=2025-11&include_voided=false"
      And the Payments listed paid the interest that figure shows

    @golden @screen:/ @screen:/payments
    Scenario: Interest collected in the year opens the Payments received then
      When the Lender opens the Dashboard
      And the Lender follows the Dashboard's "In 2025" figure
      Then the Lender is on "/payments?year=2025&include_voided=false"
      And the Payments listed paid the interest the app counts for 2025

  Rule: Collateral shows the Collateral Value of the Active Mortgages that have one
    @golden @screen:/ @screen:/mortgages
    Scenario: The Collateral Value and Loan-to-Value agree with the book, and open the Mortgages
      When the Lender opens the Dashboard
      Then the Collateral Value and Loan-to-Value tiles agree with the book
      When the Lender follows the Dashboard's "Collateral Value" figure
      Then the Lender is on "/mortgages"
      When the Lender opens the Dashboard
      And the Lender follows the Dashboard's "Loan-to-Value" figure
      Then the Lender is on "/mortgages"

    # The fresh book has no Gold Rate and no Collateral Value: no other @fresh scenario sets one.
    @fresh @screen:/
    Scenario: Without a Gold Rate or a value the Dashboard has no Loan-to-Value
      When the Lender opens the Dashboard
      Then the Dashboard's Collateral Value reads "No Gold Rate or value set yet"
      And the Dashboard's Loan-to-Value reads "—"

  Rule: Follow-up counts what the Lender has to do today
    @golden @screen:/ @screen:/call-list @screen:/reminders
    Scenario: The Call List count and the Reminders to send and to approve agree with the book
      When the Lender opens the Dashboard
      Then the Call List tile shows the number of Mortgages on today's Call List
      And the Reminders tile shows the number to send, and the number to approve
      When the Lender follows the Dashboard's "On today's Call List" figure
      Then the Lender is on "/call-list"
      When the Lender opens the Dashboard
      And the Lender follows the Dashboard's "Reminders to send" figure
      Then the Lender is on "/reminders?status=queued"
      And the Reminders to send are shown

  Rule: Closed this month counts the Mortgages closed in the QA date's month
    The golden book's Nov 2025 has one of each: Vikram's coin Redeemed, Anita's bracelet
    Waived off with ₹200 let off, and Rohit's earrings Forfeited and sold.

    @golden @screen:/ @screen:/mortgages
    Scenario Outline: <closure> opens the Mortgages closed this month that way
      When the Lender opens the Dashboard
      Then the Closed in Nov 2025 figures agree with the book
      When the Lender follows the Dashboard's "<figure>" figure
      Then the Lender is on "<address>"
      And the Mortgages listed are the <closure> ones
      And as many Mortgages are listed as the book closed this month that way

      Examples:
        | closure    | figure     | address                                       |
        | Redeemed   | Redeemed   | /mortgages?status=redeemed&closed_in=2025-11  |
        | Waived off | Waived off | /mortgages?status=waived&closed_in=2025-11    |
        | Forfeited  | Forfeited  | /mortgages?status=forfeited&closed_in=2025-11 |

  Rule: Looking ahead tells exact figures from estimates
    @golden @screen:/
    Scenario: The Looking ahead table and the Payments chart agree with the book
      When the Lender opens the Dashboard
      Then the Looking ahead table gives each of its figures for 3, 6 and 12 months, exact or estimate
      And the Payments chart shows each month received and each coming month
