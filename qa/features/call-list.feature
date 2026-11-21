Feature: Call List and Call Notes
  The Call List is the day's Mortgages to phone about: too many Months Unpaid (3, unless the
  Lender changes it), a Loan-to-Value above 85%, or accruing today, unless an Advance
  Instalment landing that day covers the month. It is worked out afresh whenever it is
  opened, grouped by Customer. A Call Note records what was said when the Lender phoned.

  Gold Rates are one per purity for the whole book, so on the work app each scenario that
  needs a Loan-to-Value keeps to the 20K Gold Rate, set to the same ₹500 a gram by every one
  of them, and no other scenario's Mortgages are valued under it. The thresholds are one
  setting for the whole book, so the scenario that changes them runs on the @fresh app, only
  ever to 4 Months Unpaid and back, and its Mortgages owe 3 months where no other lists on
  fewer than 4.

  Rule: A Mortgage is listed for each reason it has, and the legend names them
    A Mortgage lent on 8 July 2025 has 3 Months Unpaid on 5 Nov 2025, one lent on 5 Oct 2025
    accrues that day with 1 month unpaid, and one lent on 1 Nov 2025 against 20 karat gold
    is listed for its Loan-to-Value alone.

    @screen:/call-list
    Scenario: Each reason is shown, with a legend
      Given the 20K Gold Rate is ₹500 a gram
      And "Callreasons Customer" was lent ₹30,000 on 8 July 2025 against a Gold ring
      And was also lent ₹30,000 on 1 Nov 2025 against a Gold chain of 20 karat
      And was also lent ₹30,000 on 5 Oct 2025 against a Gold bangle
      And today is 5 Nov 2025
      When the Lender opens the Call List
      Then 2025-Callreasons-GoldRing is on the Call List for "3 months unpaid"
      And 2025-Callreasons-GoldChain is on the Call List for its Loan-to-Value
      And 2025-Callreasons-GoldBangle is on the Call List for "Accrues today"
      And the Call List legend names Months Unpaid, Loan-to-Value too high and Accrues today

  Rule: An Advance Instalment landing on the day covers the month only if it pays it
    A Mortgage lent on 5 Sept 2025 accrues on the 5th. Its Advance is held in parts, one on
    each Accrual Date, and a month's interest at the default 3% on ₹30,000 is ₹900.

    @screen:/call-list @screen:/payments/:id
    Scenario: A part that covers the month keeps the Mortgage off the Call List until the Advance is voided
      Given "Callcovered Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid an Advance of ₹6,000 over 2 months on it on 10 Sept 2025
      And today is 5 Oct 2025
      When the Lender opens the Call List
      Then it is not on the Call List
      When the Lender opens that Payment
      And the Lender voids it because "Entered in error"
      Then it shows "Payment of ₹6,000 voided" with the reason "Entered in error"
      When the Lender opens the Call List
      Then it is on the Call List as accruing today

    @screen:/call-list
    Scenario: A part that falls short of the month leaves it on the Call List
      Given "Callshort Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid an Advance of ₹1,000 over 2 months on it on 10 Sept 2025
      And today is 5 Oct 2025
      When the Lender opens the Call List
      Then it is on the Call List as accruing today

    @screen:/call-list
    Scenario: A cancelled part covers nothing
      Given "Callcancelled Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid an Advance of ₹6,000 over 2 months on it on 10 Sept 2025
      And its part due 5 Oct 2025 was cancelled on 1 Oct 2025
      And today is 5 Oct 2025
      When the Lender opens the Call List
      Then it is on the Call List as accruing today

    @screen:/call-list
    Scenario: Earlier unpaid months keep it on the Call List
      Given "Callbehind Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid an Advance of ₹1,800 over 2 months on it on 10 Nov 2025
      And today is 5 Dec 2025
      When the Lender opens the Call List
      Then it is on the Call List as accruing today

  Rule: The Call List groups a Customer's Mortgages
    @screen:/call-list @screen:/mortgages
    Scenario: A Customer's Mortgages are one group, with their total and both phones
      Given "Callgroup Customer" is a Customer with a second number
      And was also lent ₹30,000 on 8 July 2025 against a Gold ring
      And was also lent ₹20,000 on 8 July 2025 against a Gold chain
      And today is 5 Nov 2025
      When the Lender opens the Call List
      Then "Callgroup Customer" is one group of 2 Mortgages, owing what the app works out for them
      And their Call and WhatsApp links reach both of their numbers
      When the Lender follows their Mortgages link
      Then every Mortgage listed is for "Callgroup Customer"
      And 2025-Callgroup-GoldRing is listed
      And 2025-Callgroup-GoldChain is listed

  Rule: The Call List is ordered, sorted and paged
    # 4 Months Unpaid on 20 Nov 2025: the ring, and the bangle, which has a Loan-to-Value too;
    # 3 for the chain; 2 for the bracelet, listed for its Loan-to-Value alone.
    @screen:/call-list
    Scenario: Mortgages not yet called come first, then the most Months Unpaid, then the highest Loan-to-Value
      Given the 20K Gold Rate is ₹500 a gram
      And "Callorder Customer" was lent ₹30,000 on 10 July 2025 against a Gold ring
      And was also lent ₹30,000 on 10 Aug 2025 against a Gold chain
      And was also lent ₹30,000 on 10 July 2025 against a Gold bangle of 20 karat
      And was also lent ₹30,000 on 10 Sept 2025 against a Gold bracelet of 20 karat
      And today is 20 Nov 2025
      When the Lender opens the Call List
      Then the Call List lists the Mortgages of "Callorder Customer" in this order:
        | Mortgage                    |
        | 2025-Callorder-GoldBangle   |
        | 2025-Callorder-GoldRing     |
        | 2025-Callorder-GoldChain    |
        | 2025-Callorder-GoldBracelet |
      When the Lender marks 2025-Callorder-GoldBangle called with "Will pay on Friday"
      Then the Call List lists the Mortgages of "Callorder Customer" in this order:
        | Mortgage                    |
        | 2025-Callorder-GoldRing     |
        | 2025-Callorder-GoldChain    |
        | 2025-Callorder-GoldBracelet |
        | 2025-Callorder-GoldBangle   |

    @screen:/call-list
    Scenario: The Lender sorts a Customer's Mortgages by Mortgage and by Outstanding
      Given the 20K Gold Rate is ₹500 a gram
      And "Callsorted Customer" was lent ₹30,000 on 10 July 2025 against a Gold ring
      And was also lent ₹20,000 on 10 Aug 2025 against a Gold chain
      And was also lent ₹40,000 on 10 July 2025 against a Gold bangle of 20 karat
      And today is 20 Nov 2025
      When the Lender opens the Call List
      And the Lender sorts the Call List by "Mortgage"
      Then the Mortgages of "Callsorted Customer" are listed by Mortgage, A to Z
      When the Lender sorts the Call List by "Mortgage"
      Then the Mortgages of "Callsorted Customer" are listed by Mortgage, Z to A
      When the Lender sorts the Call List by "Outstanding"
      Then the Mortgages of "Callsorted Customer" are listed by Outstanding, largest first

    # The fresh book has no Gold Rate (the Dashboard's note says so) and this scenario sets
    # none: its Mortgages are listed for their Months Unpaid, 5 on 20 Nov 2025.
    @fresh @screen:/call-list
    Scenario: A page holds whole Customers, never a Customer split across two
      Given 19 Customers were each lent ₹30,000 on 8 June 2025 against a Gold ring
      And "Callboundary Customer" was lent ₹30,000 on 8 June 2025 against a Gold ring
      And was also lent ₹30,000 on 8 June 2025 against a Gold chain
      And 3 Customers were each lent ₹30,000 on 8 June 2025 against a Gold ring
      And today is 20 Nov 2025
      When the Lender opens the Call List
      Then the Call List shows its first twenty Customers
      And every Customer on it has all their Mortgages on the same page
      When the Lender goes to the next page
      Then every Customer on it has all their Mortgages on the same page
      And no Customer is on two pages

  Rule: Marking a Mortgage called
    Called today, a Mortgage stays on the Call List, marked.

    @screen:/call-list @screen:/mortgages/:id
    Scenario: A Call Note is needed and confirmed, then shows on the row and the Mortgage page
      Given "Callmarked Customer" was lent ₹30,000 on 8 July 2025 against a Gold ring
      And today is 5 Nov 2025
      When the Lender opens the Call List
      And starts to mark it called
      Then Called can't be pressed without a Call Note
      When the Lender types the Call Note "Will pay on Friday"
      And presses Called
      Then the confirmation lists "Note" at "Will pay on Friday"
      When the Lender saves the Call Note
      Then its row shows Called with "Will pay on Friday", and offers Again
      When the Lender opens 2025-Callmarked-GoldRing
      Then its Call Notes list "Will pay on Friday" on 5 Nov 2025

    @screen:/call-list @screen:/mortgages/:id
    Scenario: The same note on the same day is not stored twice
      Given "Calltwice Customer" was lent ₹30,000 on 8 July 2025 against a Gold ring
      And today is 5 Nov 2025
      And it was marked called with "Will pay on Friday"
      When the Lender opens the Call List
      And starts to mark it called
      And the Lender types the Call Note "Will pay on Friday"
      And presses Called
      And the Lender saves the Call Note
      And the Lender opens 2025-Calltwice-GoldRing
      Then its Call Notes list 1 Call Note

  Rule: The thresholds are the Lender's
    @fresh @screen:/settings @screen:/call-list
    Scenario: Changing the Call List thresholds in Settings changes who is listed
      Given "Callthreshold Customer" was lent ₹30,000 on 8 July 2025 against a Gold ring
      And today is 5 Nov 2025
      When the Lender opens the Call List
      Then it is on the Call List for "3 months unpaid"
      When the Lender sets the Call List to 4 Months Unpaid in Settings
      Then the confirmation lists "Months Unpaid" at "4 or more"
      When the Lender confirms
      Then the Call List thresholds are saved
      When the Lender opens the Call List
      Then it is not on the Call List
      When the Lender sets the Call List to 3 Months Unpaid in Settings
      And the Lender confirms
      And the Lender opens the Call List
      Then it is on the Call List for "3 months unpaid"

  Rule: The Dashboard counts the Call List
    @golden @screen:/ @screen:/call-list
    Scenario: The Dashboard's figure is the number of Mortgages on the Call List
      When the Lender opens the Dashboard
      And notes the Dashboard's "On today's Call List" figure
      And opens the Call List from that figure
      Then the Call List counts that many Mortgages
