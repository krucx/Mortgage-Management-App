Feature: Call Sheet export and import
  The Call Sheet is the day's Call List as an Excel or PDF sheet, a row per Mortgage, for whoever
  makes the calls to write each Call Note on. The Excel sheet is imported back to record them all
  at once: a preview shows what it would add and what it leaves out, and nothing is saved until
  the Lender adds them. The work app's Call List holds every scenario's Mortgages, so each
  scenario looks only at its own rows, and imports a sheet cut down to them.

  Rule: The Call Sheet has a row for each Mortgage on the Call List
    The Mortgages below were lent on 5 Aug 2025, so by 15 Nov 2025 three monthly interest charges
    are unpaid: that is enough to be listed.

    @screen:/call-list
    Scenario: Export to Excel and to PDF
      Given "Exportone Customer" was lent ₹30,000 on 5 Aug 2025 against a Gold ring
      And "Exporttwo Customer" was lent ₹20,000 on 5 Aug 2025 against a Gold bangle
      And today is 15 Nov 2025
      When the Lender opens the Call List
      And the Lender exports the Call List to Excel
      Then the download is named "call-list-2025-11-15.xlsx"
      And the Excel sheet has the columns "Customer, Phone numbers, Mortgage Name, Jewellery, Why listed, Months Unpaid, Outstanding, Loan-to-Value, Last Call Note, Called on, Call Note"
      And the Excel sheet has one row for 2025-Exportone-GoldRing, as the Call List shows it
      And the Excel sheet has one row for 2025-Exporttwo-GoldBangle, as the Call List shows it
      And the Call Note column is empty for 2025-Exportone-GoldRing
      When the Lender exports the Call List to PDF
      Then the download is named "call-list-2025-11-15.pdf"
      And the download is a PDF

  Rule: A filled-in Excel sheet is previewed, then its Call Notes are added
    A row is imported when it names an Active Mortgage and a Called on date from the Mortgage's
    start to today, with a Call Note written in. Rows with no note are left out quietly.

    @screen:/call-list
    Scenario: Import the exported Excel with notes filled in
      Given "Fillone Customer" was lent ₹30,000 on 5 Aug 2025 against a Gold ring
      And "Filltwo Customer" was lent ₹20,000 on 5 Aug 2025 against a Gold ring
      And "Fillthree Customer" was lent ₹10,000 on 5 Aug 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens the Call List
      And the Lender exports the Call List to Excel
      And the Lender writes these Call Notes on the exported sheet:
        | Mortgage                | Called on  | Call Note              |
        | 2025-Fillone-GoldRing   |            | Will pay on Friday     |
        | 2025-Filltwo-GoldRing   | 2025-11-12 | Asked for more time    |
        | 2025-Fillthree-GoldRing |            |                        |
        | 2025-Nobody-GoldRing    |            | Phoned the wrong shop  |
      And the Lender chooses that sheet to import
      Then the preview is adding 2 Call Notes:
        | Mortgage                | Customer           | Called on   | Call Note           |
        | 2025-Fillone-GoldRing   | Fillone Customer   | 15 Nov 2025 | Will pay on Friday  |
        | 2025-Filltwo-GoldRing   | Filltwo Customer   | 12 Nov 2025 | Asked for more time |
      And the preview leaves out these rows:
        | Row   | Mortgage Name         | Why             |
        | Row 5 | 2025-Nobody-GoldRing  | no such Mortgage |
      And the preview says it left out quietly "1 row without a Call Note"
      When the Lender adds the Call Notes
      Then the status says "Added 2 Call Notes. 1 row not imported:"
      And 2025-Fillone-GoldRing has the Call Note "Will pay on Friday" dated 15 Nov 2025
      And 2025-Filltwo-GoldRing has the Call Note "Asked for more time" dated 12 Nov 2025
      And 2025-Fillthree-GoldRing has no Call Notes
      When the Lender shows them
      Then the rows not imported are:
        | Row   | Mortgage Name         | Why             |
        | Row 5 | 2025-Nobody-GoldRing  | no such Mortgage |

    @screen:/call-list
    Scenario: Closing the preview saves nothing
      Given "Keepone Customer" was lent ₹30,000 on 5 Aug 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens the Call List
      And the Lender exports the Call List to Excel
      And the Lender writes these Call Notes on the exported sheet:
        | Mortgage                | Called on | Call Note        |
        | 2025-Keepone-GoldRing   |           | Will pay Monday  |
      And the Lender chooses that sheet to import
      Then the preview is adding 1 Call Note:
        | Mortgage                | Customer         | Called on   | Call Note       |
        | 2025-Keepone-GoldRing   | Keepone Customer | 15 Nov 2025 | Will pay Monday |
      When the Lender keeps editing
      Then the dialog is closed
      And 2025-Keepone-GoldRing has no Call Notes

  Rule: A sheet the app can't read, or rows it can't take, are refused with the reason
    The Mortgages here: one Active and one Forfeited.

    @screen:/call-list
    Scenario: A file that is not an Excel sheet
      When the Lender opens the Call List
      And the Lender chooses a text file to import
      Then the status says "This file is not an Excel sheet (.xlsx)"

    @screen:/call-list
    Scenario: A sheet without the Mortgage Name, Called on and Call Note columns
      When the Lender opens the Call List
      And the Lender chooses a sheet with only the columns "Customer, Mortgage Name" to import
      Then the status says "This sheet has no Mortgage Name, Called on and Call Note columns"

    @screen:/call-list
    Scenario: Each row that can't be imported says why
      Given "Errone Customer" was lent ₹30,000 on 5 Aug 2025 against a Gold ring
      And "Errtwo Customer" was lent ₹20,000 on 5 Aug 2025 against a Gold ring
      And it was Forfeited on 10 Nov 2025 recovering ₹0
      And today is 15 Nov 2025
      When the Lender opens the Call List
      And the Lender exports the Call List to Excel
      And the Lender writes these Call Notes on the exported sheet:
        | Mortgage              | Called on  | Call Note       |
        |                       |            | Called nobody   |
        | 2025-Nobody-GoldRing  |            | Wrong number    |
        | 2025-Errone-GoldRing  | soon       | Will pay        |
        | 2025-Errtwo-GoldRing  | 2025-11-11 | Phoned at home  |
        | 2025-Errone-GoldRing  | 2025-11-16 | Will pay        |
        | 2025-Errone-GoldRing  | 2025-07-01 | Will pay        |
        | 2025-Errone-GoldRing  |            |                 |
      And the Lender chooses that sheet to import
      Then the preview has nothing to add
      And the preview leaves out these rows:
        | Row   | Mortgage Name         | Why                                      |
        | Row 2 | “Called nobody”       | no Mortgage Name                         |
        | Row 3 | 2025-Nobody-GoldRing  | no such Mortgage                         |
        | Row 4 | 2025-Errone-GoldRing  | Called on is not a date                  |
        | Row 5 | 2025-Errtwo-GoldRing  | it is forfeited                          |
        | Row 6 | 2025-Errone-GoldRing  | Called on is after today                 |
        | Row 7 | 2025-Errone-GoldRing  | Called on is before the Mortgage started |
      And the preview says it left out quietly "1 row without a Call Note"
      And 2025-Errone-GoldRing has no Call Notes

  Rule: Importing the same file again adds nothing twice

    @screen:/call-list
    Scenario: A second import of the same sheet finds every note already there
      Given "Twiceone Customer" was lent ₹30,000 on 5 Aug 2025 against a Gold ring
      And today is 15 Nov 2025
      When the Lender opens the Call List
      And the Lender exports the Call List to Excel
      And the Lender writes these Call Notes on the exported sheet:
        | Mortgage                | Called on | Call Note        |
        | 2025-Twiceone-GoldRing  |           | Will pay Friday  |
      And the Lender chooses that sheet to import
      And the Lender adds the Call Notes
      Then the status says "Added 1 Call Note."
      When the Lender chooses that sheet to import
      Then the preview has nothing to add
      And the preview says it left out quietly "1 already there"
      And 2025-Twiceone-GoldRing has 1 Call Note
