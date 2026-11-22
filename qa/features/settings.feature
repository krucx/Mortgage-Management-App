@settings
Feature: Settings
  Each section of Settings is one setting, or a group of them, for the whole book, and saves on
  its own. They change what the rest of the app asks or offers, so these scenarios run last, one
  after another, on the @fresh app, where no other scenario is still reading them (see
  qa/playwright.config.ts). Figures are asserted as what the screens say, not worked out by hand.

  Rule: Default Terms are copied into new Mortgages only

    @screen:/settings @screen:/mortgages/new @screen:/mortgages/:id
    Scenario: New Mortgages start with the Default Terms, and existing ones keep theirs
      Given "Dfltterms Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      When the Lender opens Settings
      And the Lender sets the Default Terms to 2.5% a month
      Then the confirmation reads:
        | Monthly rate | 2.5% |
      And the confirmation says "Only new Mortgages use these; existing ones keep their Terms."
      When the Lender confirms
      Then the "Default Terms" section says "Saved. New Mortgages will start with these Terms."
      When the Lender starts a new Mortgage for "Dfltterms Customer"
      Then the new Mortgage form offers the Terms 2.5% a month
      When fills in ₹10,000 against a Gold ring
      And creates the Mortgage
      And the Lender confirms
      Then its Terms are 2.5% a month
      When the Lender opens 2025-Dfltterms-GoldChain
      Then its Terms are 3% a month

  Rule: The Cash Limit decides when cash is warned of

    @screen:/settings @screen:/mortgages/new @screen:/payments/new
    Scenario: With a Cash Limit, lending or receiving that much in cash asks first
      Given "Cashlimit Customer" was lent ₹1,00,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      When the Lender opens Settings
      And the Lender sets the Cash Limit to ₹50,000
      Then the confirmation reads:
        | Warn at cash of | ₹50,000 or more |
      When the Lender confirms
      Then the "Cash Limit" section says "Saved."
      When the Lender starts a new Mortgage for "Cashlimit Customer"
      And fills in ₹10,000 against a Gold ring
      And enters the Cash Limit as the Principal lent, in cash
      And creates the Mortgage
      Then the Lender is warned of the cash
      When the Lender goes back
      And the Lender enters ₹1 under the Cash Limit as the Principal lent, in cash
      And creates the Mortgage
      Then the Lender is asked to confirm the new Mortgage
      When the Lender opens a new Payment from "Cashlimit Customer"
      And enters ₹50,000 as the Amount received
      And the Lender saves the Payment
      Then the Lender is warned "₹50,000 in cash"

    @screen:/settings @screen:/mortgages/new @screen:/payments/new
    Scenario: With the Cash Limit cleared ("Never"), cash is never warned of
      Given "Cashnever Customer" was lent ₹1,00,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      When the Lender opens Settings
      And the Lender clears the Cash Limit
      Then the confirmation reads:
        | Warn at cash of | Never: no warning for cash |
      When the Lender confirms
      Then the "Cash Limit" section says "Saved."
      When the Lender starts a new Mortgage for "Cashnever Customer"
      And fills in ₹1,00,000 against a Gold ring
      And lends it in cash
      And creates the Mortgage
      Then the Lender is asked to confirm the new Mortgage
      When the Lender opens a new Payment from "Cashnever Customer"
      And enters ₹50,000 as the Amount received
      And the Lender saves the Payment
      Then the confirmation says "Record a Payment of ₹50,000?"

  Rule: The Discount confirmation limit decides when a Discount is asked about

    @screen:/settings @screen:/payments/new
    Scenario: With a limit, a Discount over it asks to confirm
      Given "Dsclimit Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 5 Nov 2025
      When the Lender opens Settings
      And the Lender sets the Discount confirmation limit to ₹100
      Then the confirmation reads:
        | Ask for confirmation over | ₹100 |
      When the Lender confirms
      Then the "Discount confirmation" section says "Saved."
      When the Lender starts a Payment from "Dsclimit Customer" for 2025-Dsclimit-GoldChain
      And enters ₹1,000 as the Amount received
      And enters a Discount over the confirmation limit for 2025-Dsclimit-GoldChain
      And the Lender saves the Payment
      Then the Lender is asked to confirm a Discount over the limit, listing that Discount for 2025-Dsclimit-GoldChain

    @screen:/settings @screen:/payments/new
    Scenario: With the limit cleared ("Never"), no Discount is asked about
      Given "Dsclear Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 5 Nov 2025
      When the Lender opens Settings
      And the Lender clears the Discount confirmation limit
      Then the confirmation reads:
        | Ask for confirmation over | Never |
      When the Lender confirms
      Then the "Discount confirmation" section says "Saved."
      When the Lender starts a Payment from "Dsclear Customer" for 2025-Dsclear-GoldChain
      And enters ₹1,000 as the Amount received
      And enters a Discount of ₹10,000 for 2025-Dsclear-GoldChain
      And the Lender saves the Payment
      Then the confirmation says "Record a Payment of ₹1,000 cash and Discount?"

  Rule: The Grace Period decides how late a Payment can still count as on time

    @screen:/settings @screen:/payments/new
    Scenario: A longer Grace Period puts a later date within Grace
      Given "Gracedays Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 9 Oct 2025
      When the Lender opens Settings
      And the Lender sets the Grace Period to 5 days
      Then the confirmation reads:
        | Grace Period | 5 days |
      When the Lender confirms
      Then the "Grace Period" section says "Saved."
      When the Lender opens a new Payment from "Gracedays Customer"
      Then the Last Accrual Date of 2025-Gracedays-GoldChain reads "5 Oct", within the Grace Period

    @screen:/settings @screen:/payments/new
    Scenario: With no Grace Period, no Grace is offered
      Given "Gracenone Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 7 Oct 2025
      When the Lender opens Settings
      And the Lender clears the Grace Period
      Then the confirmation reads:
        | Grace Period | None: no Grace |
      When the Lender confirms
      Then the "Grace Period" section says "Saved."
      When the Lender opens a new Payment from "Gracenone Customer"
      Then the Last Accrual Date of 2025-Gracenone-GoldChain reads "5 Oct", in no colour
      And no Grace is offered

  Rule: WhatsApp templates are previewed as typed, and only placeholders the app can fill are saved

    @screen:/settings
    Scenario: The template's formatting is previewed as the Lender types
      When the Lender opens Settings
      And the Lender writes "*Thank you* for _paying_" as the Receipt template
      Then the Receipt preview shows "Thank you" in bold and "paying" in italics

    @screen:/settings
    Scenario: Each template lists the placeholders the app can fill
      When the Lender opens Settings
      Then the Receipt template lists the placeholders the app can fill
      And the Reminder template lists the placeholders the app can fill

    @screen:/settings
    Scenario: A placeholder the app can't fill is refused, and the template is not saved
      When the Lender opens Settings
      And the Lender writes "Hi {nobody}, we received {amount}" as the Receipt template
      And the Lender saves the WhatsApp messages
      Then Settings refuses it, saying "The Receipt template can't fill {nobody}."
      And the Receipt template is not saved

  Rule: Each section saves on its own

    @screen:/settings
    Scenario: One section saved, another refused, the rest untouched
      When the Lender opens Settings
      And the Lender sets the Grace Period to 4 days
      And the Lender confirms
      Then the "Grace Period" section says "Saved."
      And the "Cash Limit" section does not say "Saved."
      When the Lender writes "Hi {nobody}" as the Receipt template
      And the Lender saves the WhatsApp messages
      Then Settings refuses it, saying "The Receipt template can't fill {nobody}."
      And the "Grace Period" section says "Saved."
      And the "Default Terms" section does not say "Saved."
      And the "Backups" section does not say "Saved."

  Rule: Backups say how things stand, and ask before they act

    @screen:/settings
    Scenario: No Backup yet
      Given no Backup has been taken yet
      When the Lender opens Settings
      Then Backups says "No Backup yet."
      And Back up now is available

    @screen:/settings
    Scenario: The last Backup, and that it is not password-protected
      Given the last Backup was taken on 15 Nov 2025 as "mortgage-backup-2025-11-15-1030.zip"
      When the Lender opens Settings
      Then Backups says "Last Backup"
      And Backups says "mortgage-backup-2025-11-15-1030.zip"
      And Backups says "Backups are not password-protected: set BACKUP_PASSWORD in the .env file."

    @screen:/settings
    Scenario: A password-protected Backup carries no such warning
      Given Backups are password-protected
      When the Lender opens Settings
      Then Backups says "Back up now"
      And Backups does not say "not password-protected"

    @screen:/settings
    Scenario: A failed Backup says why
      Given the last Backup failed with "The disk is full"
      When the Lender opens Settings
      Then Backups says "The last Backup failed: The disk is full"

    @screen:/settings
    Scenario: Back up now asks first, and takes the Backup once confirmed
      Given the app keeps the last 4 Backups
      When the Lender opens Settings
      And the Lender starts a Backup now
      Then the confirmation says "only the last 4 Backups are kept"
      When the Lender cancels the Backup
      Then the dialog is closed
      And no new Backup is taken
      When the Lender starts a Backup now
      And the Lender confirms the Backup
      Then a new Backup is taken
      And Backups lists it as the last Backup

    @screen:/settings
    Scenario: Back up now is disabled while a Backup runs
      Given a Backup is running
      When the Lender opens Settings
      Then Backups says "Backing up…"
      And Back up now is disabled

    @screen:/settings
    Scenario: Changing how many Backups are kept asks first
      Given the app keeps the last 4 Backups
      When the Lender opens Settings
      And the Lender sets Backups to keep the last 2
      Then the confirmation reads:
        | Keep the last | 2 |
      When the Lender confirms
      Then the "Backups" section says "Saved."
      And Backups are kept to the last 2
      When the Lender sets Backups to keep the last 4
      And the Lender confirms
      Then Backups are kept to the last 4

    @screen:/
    Scenario: A Backup is taken when the last one is a week old by the QA clock
      Given the Backups taken so far are noted
      And today is 1 Jan 2031
      When the Lender opens the Dashboard
      Then a new Backup is taken
