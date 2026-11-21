Feature: Closures page
  The Closures page lists the Dormant Mortgages, Active ones that owe nothing, to Redeem, and
  lets the Lender Forfeit or Waive off several Active Mortgages at once. A Dormant Mortgage is
  worked out afresh from the Payments (ADR 0012), and a bulk Closure closes all of its
  Mortgages or none.

  Rule: A Dormant Mortgage is flagged, listed and kept out of the day's work
    Sunil's anklet, in the golden book, is the one Mortgage that owes nothing.

    @golden @screen:/ @screen:/closures @screen:/call-list @screen:/reminders @screen:/payments/new
    Scenario: A Dormant Mortgage gets a red dot, a place on Closures and no Notices
      When the Lender notes the Mortgage that owes nothing
      And the Lender opens the Dashboard
      Then the Closures tab shows a red dot, with the tooltip "1 Dormant: owing nothing, to Redeem"
      When the Lender opens the Closures page
      Then the Dormant section lists it, to Redeem
      When the Lender opens the Call List
      Then it is not on the Call List
      When the Lender opens the Reminders page on 15 Nov 2025
      Then no Reminder is listed for "Sunil Mehta"
      When the Lender opens a new Payment from "Sunil Mehta"
      Then their Mortgage that owes nothing reads "owes nothing: Redeem it" and can't be ticked

    # The fresh book has no other Dormant Mortgage: no other @fresh scenario leaves one.
    @fresh @screen:/ @screen:/closures @screen:/mortgages/:id/redeem
    Scenario: A Dormant Mortgage is Redeemed for ₹0 from the Closures page
      Given "Slip Customer" was lent ₹1,00,000 on 14 Jan 2026 at 3% a month, simple, with nothing for a part month
      And paid ₹3,000 on it on 15 Apr 2026, entered on 20 Apr 2026
      And paid ₹50,000 on it on 10 Apr 2026, entered on 20 Apr 2026
      And paid ₹56,000 on it on 9 Apr 2026, entered on 20 Apr 2026
      And today is 20 Apr 2026
      When the Lender opens the Dashboard
      Then the Closures tab shows a red dot, with the tooltip "1 Dormant: owing nothing, to Redeem"
      When the Lender opens the Closures page
      And the Lender redeems it from the Closures page for ₹0
      Then it is Redeemed
      When the Lender opens the Closures page
      Then it is no longer listed as Dormant
      And the Closures tab has no red dot

  Rule: Closing several Mortgages at once
    The Mortgages are chosen from the page's list, so each scenario's Customers are named to come
    first when it is sorted by Customer.

    @screen:/closures
    Scenario: Forfeit two Mortgages on one date with one note
      Given "Aaforone Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold ring
      And "Aafortwo Customer" was lent ₹20,000 on 5 Oct 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens the Closures page
      And the Lender sorts the Mortgages to close by "Customer"
      And the Lender chooses 2025-Aaforone-GoldRing to close
      And the Lender chooses 2025-Aafortwo-GoldRing to close
      And the Lender chooses 12 Nov 2025 as the Closure date
      And the Lender gives "Auctioned together" as the note
      And the Lender enters ₹10,000 as the Recovered Amount for 2025-Aaforone-GoldRing
      And the Lender enters ₹40,000 as the Recovered Amount for 2025-Aafortwo-GoldRing
      Then the total is the profit or loss the app works out
      When the Lender forfeits them
      Then the confirmation says "Forfeit 2 Mortgages?"
      When the Lender confirms the Closure
      Then the book has 2025-Aaforone-GoldRing as "forfeited"
      And the book has 2025-Aafortwo-GoldRing as "forfeited"

    @screen:/closures
    Scenario: Waive off two Mortgages, the method asked only when something is received
      Given "Aawaiveone Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold ring
      And "Aawavetwo Customer" was lent ₹20,000 on 5 Oct 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens the Closures page
      And the Lender sorts the Mortgages to close by "Customer"
      And the Lender chooses 2025-Aawaiveone-GoldRing to close
      And the Lender chooses 2025-Aawavetwo-GoldRing to close
      And the Lender chooses to waive the chosen off
      And the Lender enters ₹0 as received now for 2025-Aawaiveone-GoldRing
      And the Lender enters ₹0 as received now for 2025-Aawavetwo-GoldRing
      Then the Final Payments method is not asked for
      When the Lender enters ₹500 as received now for 2025-Aawavetwo-GoldRing
      Then the Final Payments method is asked for
      When the Lender gives "Small balances let off" as the reason for all
      Then the total waived is what the app works out
      When the Lender waives them off
      Then the confirmation says "Waive off 2 Mortgages?"
      When the Lender confirms the Closure
      Then the book has 2025-Aawaiveone-GoldRing as "waived"
      And the book has 2025-Aawavetwo-GoldRing as "waived"

    @screen:/closures
    Scenario: One refused Mortgage in a bulk Forfeit closes none
      Given "Aarefuseone Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold ring
      And "Aarefusetwo Customer" was lent ₹20,000 on 10 Nov 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens the Closures page
      And the Lender sorts the Mortgages to close by "Customer"
      And the Lender chooses 2025-Aarefuseone-GoldRing to close
      And the Lender chooses 2025-Aarefusetwo-GoldRing to close
      And the Lender chooses 1 Nov 2025 as the Closure date
      And the Lender enters ₹1,000 as the Recovered Amount for 2025-Aarefuseone-GoldRing
      And the Lender enters ₹1,000 as the Recovered Amount for 2025-Aarefusetwo-GoldRing
      Then the Closure is refused: "2025-Aarefusetwo-GoldRing had not started on that date"
      And forfeiting 2025-Aarefuseone-GoldRing and 2025-Aarefusetwo-GoldRing on 1 Nov 2025 is refused
      And the book has 2025-Aarefuseone-GoldRing as "active"
      And the book has 2025-Aarefusetwo-GoldRing as "active"

  Rule: Both lists sort and come twenty a page, and the chosen come first

    @screen:/closures
    Scenario: The Dormant list sorts by Mortgage and Customer and comes twenty a page
      Given 21 Customers were each left owing nothing by back-dated Payments
      And today is 20 Apr 2026
      When the Lender opens the Closures page
      Then the Dormant list shows its first twenty
      When the Lender goes to the next page of Dormant
      Then the Dormant list shows the rest
      When the Lender sorts the Dormant Mortgages by "Mortgage"
      Then the Dormant Mortgages are listed by Mortgage, A to Z
      When the Lender sorts the Dormant Mortgages by "Mortgage"
      Then the Dormant Mortgages are listed by Mortgage, Z to A
      When the Lender sorts the Dormant Mortgages by "Customer"
      Then the Dormant Mortgages are listed by Customer, A to Z

    @screen:/closures
    Scenario: The Mortgages to close sort by Started and Outstanding
      Given "Sortone Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold ring
      And "Sorttwo Customer" was lent ₹50,000 on 5 Oct 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens the Closures page
      And the Lender sorts the Mortgages to close by "Started"
      Then the Mortgages to close are listed by Started, newest first
      When the Lender sorts the Mortgages to close by "Started"
      Then the Mortgages to close are listed by Started, oldest first
      When the Lender sorts the Mortgages to close by "Outstanding today"
      Then the Mortgages to close are listed by Outstanding today, largest first

    @screen:/closures
    Scenario: The Mortgages to close come twenty a page
      Given "Zzpager Customer" was lent ₹30,000 on 5 Sept 2025 against 21 Gold rings
      And today is 15 Nov 2025
      When the Lender opens the Closures page
      Then the Mortgages to close show their first twenty
      When the Lender goes to the next page of the Mortgages to close
      Then the Mortgages to close show their last page

    @screen:/closures
    Scenario: A chosen Mortgage moves to the top of the list
      Given "Aatickaa Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold ring
      And "Aatickbb Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold ring
      And "Aatickcc Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens the Closures page
      And the Lender sorts the Mortgages to close by "Customer"
      And the Lender chooses 2025-Aatickcc-GoldRing to close
      Then 2025-Aatickcc-GoldRing is the first of the Mortgages to close

  Rule: An empty book has nothing to close

    # @empty: before any other @fresh scenario adds a Mortgage (qa/playwright.config.ts).
    @empty @screen:/closures
    Scenario: The Closures page of an empty book
      When the Lender opens the Closures page
      Then the Dormant section says "None: every Active Mortgage owes something."
      And the Forfeit or Waive off section says "No Active Mortgages with anything Outstanding."
      And the Closures tab has no red dot
