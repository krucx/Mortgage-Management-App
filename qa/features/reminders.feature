Feature: Reminders
  A Reminder is queued for each Customer days before their Mortgages' Accrual Dates (two,
  unless the Lender changes it). In QA mode the request's date is the day the daily run
  queues them for.

  @screen:/reminders
  Scenario: The Reminders page follows the date
    Given "Reminder Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold bracelet
    When the Lender opens the Reminders page on 2 Dec 2025
    Then no Reminder is listed for "Reminder Customer"
    When the Lender opens the Reminders page on 3 Dec 2025
    Then a Reminder to "Reminder Customer" for 5 Dec 2025 is to send
