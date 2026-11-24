Feature: Dialogs
  A confirmation is a dialog inside the app. Esc, its × and a click on the page around it
  close it without doing anything; it opens with Cancel focused, so a stray Enter does not
  carry the change out. A dialog that asks for a reason keeps what was typed.

  Rule: A confirmation closes without doing anything

    @screen:/customers
    Scenario Outline: <way> closes the Delete dialog and the Customer stays
      Given "<customer>" is a Customer
      When the Lender starts to delete "<customer>" from the Customers list
      Then the dialog is open
      When <way>
      Then the dialog is closed
      And the Customers listed are:
        | <customer> |

      Examples:
        | way                          | customer              |
        | presses Esc                  | Dialog Esc Customer   |
        | closes the dialog with its × | Dialog Cross Customer |
        | clicks outside the dialog    | Dialog Click Customer |

    @screen:/customers
    Scenario: A confirmation opens with Cancel focused, so Enter does not delete
      Given "Dialog Focus Customer" is a Customer
      When the Lender starts to delete "Dialog Focus Customer" from the Customers list
      Then the dialog's Cancel button is focused
      When presses Enter
      Then the dialog is closed
      And the Customers listed are:
        | Dialog Focus Customer |

  Rule: A dialog that needs a reason will not go on without one

    @screen:/payments/:id
    Scenario: Void Payment waits for a reason, and a click outside closes the dialog only while there is none
      Given "Voidreason Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 5 Oct 2025
      And today is 15 Nov 2025
      When the Lender opens that Payment
      And the Lender starts to void it
      Then Void Payment cannot be pressed
      When the Lender types the reason "   "
      Then Void Payment cannot be pressed
      When presses Esc
      Then the dialog is closed
      When the Lender starts to void it
      And clicks outside the dialog
      Then the dialog is closed
      When the Lender starts to void it
      And the Lender types the reason "Entered twice"
      Then Void Payment can be pressed
      When clicks outside the dialog
      Then the dialog is still open
      And the reason still reads "Entered twice"
      When presses Esc
      Then the dialog is closed

    @screen:/payments/:id
    Scenario: A refusal from the app is shown in the dialog, which stays open with the reason
      Given "Voidrefusal Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 5 Oct 2025
      And today is 15 Nov 2025
      And the app refuses to void a Payment, saying "The book is closed for the year"
      When the Lender opens that Payment
      And the Lender starts to void it
      And the Lender types the reason "Entered twice"
      And presses Void Payment
      Then the confirmation says "The book is closed for the year"
      And the dialog is still open
      And the reason still reads "Entered twice"
      When clicks outside the dialog
      Then the dialog is still open
