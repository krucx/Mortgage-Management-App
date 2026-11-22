Feature: Reminders
  A Reminder is queued for each Customer days before their Mortgages' Accrual Dates (two,
  unless the Lender changes it), covering every one of their Mortgages accruing that day. In QA
  mode the request's date is the day the daily run queues them for.

  Every API request on a new date runs that date's daily jobs, which withdraw the unsent Reminders
  queued by then further ahead than two days from it, and each read of the Reminders does the
  same. So the scenarios here keep to January 2020, before every date any other scenario uses
  (Mortgages lent in October 2019, read on 2 and 3 Jan 2020, and 6 Jan for the pager's), so no
  other scenario's date can take a Reminder from under them, and they run in parallel: a read on
  an earlier date leaves alone the Reminders queued on a later one. The days before, the wording
  and approving first are settings for the whole book that only Reminders read, so the
  scenarios that change them are tagged "settings": they run one after another, once every
  "fresh" scenario is done, and put back what they change.

  Rule: A Reminder is queued days before the Accrual Date, for every Mortgage accruing then

    @screen:/reminders
    Scenario: The Reminders page follows the date
      Given "Reminder Customer" was lent ₹30,000 on 5 Oct 2019 against a Gold bracelet
      When the Lender opens the Reminders page on 2 Jan 2020
      Then no Reminder is listed for "Reminder Customer"
      When the Lender opens the Reminders page on 3 Jan 2020
      Then a Reminder to "Reminder Customer" for 5 Jan 2020 is to send

    @screen:/reminders
    Scenario: One Reminder covers every Mortgage of the Customer accruing that day
      Given "Remcovers Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      And was also lent ₹40,000 on 4 Oct 2019 against a Gold chain
      And was also lent ₹20,000 on 5 Oct 2019 against a Gold bangle
      When the Lender opens the Reminders page on 2 Jan 2020
      Then a Reminder to "Remcovers Customer" for 4 Jan 2020 is to send
      And the Reminder to "Remcovers Customer" for 4 Jan 2020 covers 2019-Remcovers-GoldChain and 2019-Remcovers-GoldRing, and no other Mortgage

  Rule: The tabs split the Reminders by where they are, and the list is sorted and paged

    @screen:/reminders
    Scenario: Each tab lists the Reminders in its status, and the empty ones say so
      Given "Remtabsent Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      And "Remtabskipped Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      And "Remtabqueued Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      When the Lender opens the Reminders page on 2 Jan 2020
      And the Lender sends the Reminder to "Remtabsent Customer" for 4 Jan 2020
      And the Lender skips the Reminder to "Remtabskipped Customer" for 4 Jan 2020
      Then a Reminder to "Remtabqueued Customer" for 4 Jan 2020 is to send
      And no Reminder is listed for "Remtabsent Customer"
      And no Reminder is listed for "Remtabskipped Customer"
      When the Lender opens the Reminders tab "Sent"
      Then a Reminder to "Remtabsent Customer" for 4 Jan 2020 is sent
      And no Reminder is listed for "Remtabqueued Customer"
      When the Lender opens the Reminders tab "Skipped"
      Then a Reminder to "Remtabskipped Customer" for 4 Jan 2020 is skipped
      When the Lender opens the Reminders tab "All"
      Then a Reminder to "Remtabsent Customer" for 4 Jan 2020 is sent
      And a Reminder to "Remtabskipped Customer" for 4 Jan 2020 is skipped
      And a Reminder to "Remtabqueued Customer" for 4 Jan 2020 is to send
      # Nothing is held for approval: only the "settings" scenarios below turn approve-first
      # on, one at a time, and each of them puts it back.
      When the Lender opens the Reminders tab "To approve"
      Then the list says "No Reminders here."

    @screen:/reminders
    Scenario: The Reminders are sorted by the heading the Lender picks, across every page
      Given "Remsorta Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      And "Remsortb Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      When the Lender opens the Reminders page on 2 Jan 2020
      And the Lender sorts the list by "Customer"
      Then the Reminders are listed by Customer, A to Z
      When sorts it the other way
      Then the Reminders are listed by Customer, Z to A
      When the Lender sorts the list by "Mortgages"
      Then the Reminders are listed by Mortgage, A to Z

    @screen:/reminders
    Scenario: A page holds twenty Reminders and the pager moves between pages
      Given 21 Customers were each lent ₹30,000 on 8 Oct 2019 against a Gold ring
      When the Lender opens the Reminders page on 6 Jan 2020
      Then the Reminders show their first twenty
      When the Lender goes to the next page
      Then the Reminders show a second page
      When the Lender goes to the previous page of Reminders
      Then the Reminders show their first twenty

  Rule: A Reminder is sent on WhatsApp, or skipped, once

    @screen:/reminders
    Scenario: Sending opens WhatsApp for the number the Lender chooses and marks the Reminder sent
      Given "Remsend Customer" is a Customer with a second number
      And was also lent ₹30,000 on 4 Oct 2019 against a Gold ring
      When the Lender opens the Reminders page on 2 Jan 2020
      And the Lender starts to send the Reminder to "Remsend Customer" for 4 Jan 2020
      Then the Reminder can be sent to either of their numbers
      When the Lender chooses to send to their second number
      And the Lender sends the Reminder on WhatsApp
      Then WhatsApp opens for their second number with the Reminder text
      And no Reminder is listed for "Remsend Customer"
      When the Lender opens the Reminders tab "Sent"
      Then a Reminder to "Remsend Customer" for 4 Jan 2020 is sent on 2 Jan 2020
      When the Lender opens the Message of the Reminder to "Remsend Customer" for 4 Jan 2020
      Then the Message is the Reminder text the app sent
      And approving, sending or skipping the Reminder to "Remsend Customer" for 4 Jan 2020 is refused: "This Reminder is already sent"

    @screen:/reminders
    Scenario: A skipped Reminder stays as history and can't be acted on again
      Given "Remskip Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      When the Lender opens the Reminders page on 2 Jan 2020
      And the Lender skips the Reminder to "Remskip Customer" for 4 Jan 2020
      Then no Reminder is listed for "Remskip Customer"
      When the Lender opens the Reminders tab "Skipped"
      Then a Reminder to "Remskip Customer" for 4 Jan 2020 is skipped
      When the Lender opens the Message of the Reminder to "Remskip Customer" for 4 Jan 2020
      Then the Message is the Reminder text the app sent
      And approving, sending or skipping the Reminder to "Remskip Customer" for 4 Jan 2020 is refused: "This Reminder is already skipped"

  Rule: There is nothing to send once no Mortgage accrues that day or an Advance covers the month

    @screen:/reminders
    Scenario: A Reminder is withdrawn when its only Mortgage is redeemed
      Given "Remclosed Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      When the Lender opens the Reminders page on 2 Jan 2020
      Then a Reminder to "Remclosed Customer" for 4 Jan 2020 is to send
      When the Lender redeems it on 2 Jan 2020
      And the Lender opens the Reminders page on 2 Jan 2020
      Then no Reminder is listed for "Remclosed Customer"

    # An Advance of ₹9,000 over 3 months is held in parts of ₹3,000 on 4 Nov, 4 Dec and 4 Jan,
    # and a month's interest at the default 3% on ₹30,000 is ₹900.
    @screen:/reminders @screen:/mortgages/:id
    Scenario: A part of an Advance that covers the month withdraws the Reminder until it is cancelled
      Given "Remcovered Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold chain
      And paid an Advance of ₹9,000 over 3 months on it on 8 Oct 2019
      When the Lender opens the Reminders page on 2 Jan 2020
      Then no Reminder is listed for "Remcovered Customer"
      When the Lender opens the Mortgage on 2 Jan 2020
      And the Lender cancels the part on 4 Jan 2020
      And the Lender opens the Reminders page on 2 Jan 2020
      Then a Reminder to "Remcovered Customer" for 4 Jan 2020 is to send

    @screen:/reminders @screen:/payments/:id
    Scenario: Voiding the Advance brings the Reminder back
      Given "Remvoided Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold chain
      And paid an Advance of ₹9,000 over 3 months on it on 8 Oct 2019
      When the Lender opens the Reminders page on 2 Jan 2020
      Then no Reminder is listed for "Remvoided Customer"
      When the Lender opens that Payment
      And the Lender voids it because "Entered in error"
      Then it shows "Payment of ₹9,000 voided" with the reason "Entered in error"
      When the Lender opens the Reminders page on 2 Jan 2020
      Then a Reminder to "Remvoided Customer" for 4 Jan 2020 is to send

  Rule: The Dashboard counts the Reminders to send
    @golden @screen:/ @screen:/reminders
    Scenario: The Dashboard's figure is the number of Reminders to send
      When the Lender opens the Dashboard
      And notes the Reminders to send on the Dashboard
      And opens the Reminders from that figure
      Then the Reminders to send are that many

  @settings
  Rule: The Lender's settings shape the queue and its wording

    @screen:/settings @screen:/reminders
    Scenario: Lowering the days before withdraws the Reminders queued further ahead
      Given "Remdays Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      When the Lender opens the Reminders page on 2 Jan 2020
      Then a Reminder to "Remdays Customer" for 4 Jan 2020 is to send
      When the Lender queues Reminders 1 day before an Accrual Date in Settings
      And the Lender opens the Reminders page on 2 Jan 2020
      Then no Reminder is listed for "Remdays Customer"
      When the Lender opens the Reminders page on 3 Jan 2020
      Then a Reminder to "Remdays Customer" for 4 Jan 2020 is to send
      When the Lender queues Reminders 2 days before an Accrual Date in Settings
      And the Lender opens the Reminders page on 2 Jan 2020
      Then a Reminder to "Remdays Customer" for 4 Jan 2020 is to send

    @screen:/settings @screen:/reminders
    Scenario: With approve-first on, a Reminder is approved after reading its message, then it is ready to send
      Given "Remapprove Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      When the Lender opens the Reminders page on 2 Jan 2020
      Then a Reminder to "Remapprove Customer" for 4 Jan 2020 is to send
      When the Lender needs Reminders approved first in Settings
      And the Lender opens the Reminders page on 2 Jan 2020
      Then no Reminder is listed for "Remapprove Customer"
      When the Lender opens the Reminders tab "To approve"
      Then a Reminder to "Remapprove Customer" for 4 Jan 2020 is to approve
      When the Lender starts to review the Reminder to "Remapprove Customer" for 4 Jan 2020
      Then the WhatsApp preview shows the Reminder text the app wrote
      When the Lender approves the Reminder
      And the Lender opens the Reminders tab "To send"
      Then a Reminder to "Remapprove Customer" for 4 Jan 2020 is to send
      When the Lender no longer needs Reminders approved first in Settings
      And the Lender needs Reminders approved first in Settings
      And the Lender opens the Reminders page on 2 Jan 2020
      And the Lender opens the Reminders tab "To approve"
      Then a Reminder to "Remapprove Customer" for 4 Jan 2020 is to approve
      When the Lender no longer needs Reminders approved first in Settings
      And the Lender opens the Reminders page on 2 Jan 2020
      Then a Reminder to "Remapprove Customer" for 4 Jan 2020 is to send

    @screen:/ @screen:/settings @screen:/reminders
    Scenario: The Dashboard counts the Reminders still to approve and links to them
      Given "Remcounted Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      And today is 2 Jan 2020
      When the Lender needs Reminders approved first in Settings
      And the Lender opens the Dashboard
      Then the Dashboard says some Reminders are to approve
      When opens the Reminders from that figure
      Then the Reminders tab opened is the one the figure promised
      When the Lender no longer needs Reminders approved first in Settings

    @screen:/settings @screen:/reminders
    Scenario: The Reminder wording comes from the template, and a placeholder it can't fill is refused
      Given "Remwording Customer" was lent ₹30,000 on 4 Oct 2019 against a Gold ring
      And today is 2 Jan 2020
      When the Lender tries to save the Reminder template "Dear {name}, {mortgages} accrues on {date}" in Settings
      Then Settings refuses it, saying "The Reminder template can't fill {name}."
      And the Reminder template is not saved
      When the Lender changes the Reminder template in Settings to "Namaste {customer_name}: interest {interest}, total {total_owed} on {date} {mortgages}"
      Then the Reminder template lists the placeholders the app can fill
      When the Lender opens the Reminders page on 2 Jan 2020
      And the Lender starts to send the Reminder to "Remwording Customer" for 4 Jan 2020
      Then the Reminder preview begins "Namaste Remwording Customer: interest ₹"
      And the WhatsApp preview shows the Reminder text the app wrote
      When the Lender puts the Reminder template back
