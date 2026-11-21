Feature: Receipts and Voids
  Every Payment has a Receipt for the Customer; a voided one stays on record without it.

  Background:
    Given today is 15 Nov 2025

  @golden @screen:/payments/:id @screen:/payments/:id/receipt
  Scenario: A Payment's Receipt names the jewellery, not the Mortgage
    Ramesh's ₹15,000 UPI Advance on his gold ring, received 10 Sept 2025.

    When the Lender opens the Payment "UPI advance Ramesh"
    Then its Receipt is addressed to "Ramesh Kumar" and names the "Gold ring"
    And its Receipt does not name 2025-Ramesh-GoldRing
    When the Lender prints the Receipt
    Then the printable Receipt lists:
      | ₹5,000 on 5 Oct 2025 |
      | ₹5,000 on 5 Nov 2025 |
      | ₹5,000 on 5 Dec 2025 |

  @screen:/payments/:id
  Scenario: A voided Payment stays on record with its reason and no Receipt
    Given "Void Customer" was lent ₹40,000 on 5 Sept 2025 against a Gold bangle
    And paid ₹1,000 on it on 15 Nov 2025
    When the Lender opens that Payment
    Then it has a Receipt
    When the Lender voids it because "Entered twice"
    Then it shows "Payment of ₹1,000 voided" with the reason "Entered twice"
    And it has no Receipt and cannot be voided again

  Rule: The Payment page shows how each Payment was allocated
    A Discount, what Grace let off and an Advance each get a column only on a Payment that has one.

    @screen:/payments/:id
    Scenario: An ordinary Payment with a Discount shows no Let off or Advance column
      Given "Columnspay Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 with a Discount of ₹100 on it on 15 Nov 2025
      When the Lender opens that Payment
      Then its Allocations table has a "Discount" column
      And its Allocation to 2025-Columnspay-GoldChain shows ₹100 under "Discount"
      And its Allocations table has no "Let off" column
      And its Allocations table has no "Advance" column

    @golden @screen:/payments/:id
    Scenario: A Grace Payment adds a Let off column
      Meera's "grace Meera" Payment, received 7 Oct 2025 and dated 4 Oct 2025.

      When the Lender opens the Payment "grace Meera"
      Then its Allocations table has a "Let off" column
      And its Allocation to 2025-Meera-GoldNecklace shows what the Payment let off under "Let off"
      And its Allocations table has no "Advance" column

    @golden @screen:/payments/:id
    Scenario: An Advance Payment adds an Advance column
      When the Lender opens the Payment "UPI advance Ramesh"
      Then its Allocations table has a "Advance" column
      And its Allocation to 2025-Ramesh-GoldRing shows ₹15,000 under "Advance"
      And its Allocations table has no "Let off" column

    @screen:/payments/:id @screen:/payments/new
    Scenario: Recording another Payment for the same Customer
      Given "Againpay Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 15 Nov 2025
      When the Lender opens that Payment
      And the Lender records another Payment for the same Customer
      Then the Payment is from "Againpay Customer"
      And 2025-Againpay-GoldChain is ticked

  Rule: The Receipt panel previews the WhatsApp message and opens WhatsApp to send it

    @golden @screen:/payments/:id
    Scenario: The preview shows the Receipt as the Customer will see it
      Ramesh's "split Ramesh" Payment, across his ring and his chain.

      When the Lender opens the Payment "split Ramesh"
      Then the WhatsApp preview shows the Receipt the app wrote, with its heading in bold
      And the preview has a card for each jewellery paid
      And the preview names no Mortgage Name

    @golden @screen:/payments/:id
    Scenario: Send on WhatsApp opens the link with the Customer's number and the Receipt
      When the Lender opens the Payment "split Ramesh"
      And the Lender sends the Receipt on WhatsApp
      Then WhatsApp opens on api.whatsapp.com for "Ramesh Kumar" with the Receipt text
      And the Lender is told to press Send in WhatsApp

    @screen:/payments/:id
    Scenario: A Customer with two numbers chooses which to send to
      Given "Twonum Customer" is a Customer with two contact numbers
      And was also lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 15 Nov 2025
      When the Lender opens that Payment
      Then the Lender can send the Receipt to either of their numbers
      When the Lender sends the Receipt on WhatsApp
      Then WhatsApp opens for their first number
      When the Lender chooses to send to their second number
      And the Lender sends the Receipt on WhatsApp
      Then WhatsApp opens for their second number

  Rule: The printable Receipt shows what the Customer needs, never the Mortgage Name

    @screen:/payments/:id/receipt
    Scenario: An ordinary Receipt
      Given "Plainreceipt Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 15 Nov 2025
      When the Lender opens that Payment
      And the Lender prints the Receipt
      Then the printable Receipt is from "Plainreceipt Customer" for what the Payment received
      And the printable Receipt lists the "Gold chain"
      And the printable Receipt does not name 2025-Plainreceipt-GoldChain

    @golden @screen:/payments/:id/receipt
    Scenario: A Grace Payment's Receipt
      When the Lender opens the Payment "grace Meera"
      And the Lender prints the Receipt
      Then the Receipt says it was received on 7 Oct 2025, counted as paid on 4 Oct 2025
      And the Receipt lets off what the Payment did, Mortgage by Mortgage

    @golden @screen:/payments/:id/receipt
    Scenario: An Advance Receipt marks what is paid now and dates each part
      When the Lender opens the Payment "UPI advance Ramesh"
      And the Lender prints the Receipt
      Then the printable Receipt has the column "Paid now"
      And the printable Receipt lists:
        | ₹5,000 on 5 Oct 2025 |
        | ₹5,000 on 5 Nov 2025 |
        | ₹5,000 on 5 Dec 2025 |

    # Its route, /payments/:id/advance-instalments/:instalment/receipt, is tagged in advances.feature.
    @golden
    Scenario: A cancelled Advance Instalment's Receipt says Advance applied
      Ramesh's ring: the 5 Oct part was cancelled on 20 Sept 2025.

      When the Lender opens 2025-Ramesh-GoldRing
      And the Lender opens the Receipt of the part cancelled that was due 5 Oct 2025
      Then the Receipt page is headed "Advance applied"
      And the printable Receipt says it was applied on 20 Sept 2025, from the Advance part due 5 Oct 2025
      And the printable Receipt does not name 2025-Ramesh-GoldRing

    @golden @screen:/payments/:id/receipt
    Scenario: A Payment across several Mortgages ends in a Total
      When the Lender opens the Payment "split Ramesh"
      And the Lender prints the Receipt
      Then the printable Receipt has a line for each of the Payment's Mortgages
      And the printable Receipt's Total is what the Payment paid and what is still owed

    @golden @screen:/payments/:id/receipt
    Scenario: A Receipt that Redeemed the Mortgage says so
      When the Lender opens the Payment "UPI closure Vikram"
      And the Lender prints the Receipt
      Then the printable Receipt lists the "Gold coin (Redeemed)"
      And the printable Receipt does not name 2025-Vikram-GoldCoin

    @screen:/payments/:id/receipt @screen:/payments/new
    Scenario: Recording another Payment from the Receipt
      Given "Receiptagain Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 15 Nov 2025
      When the Lender opens that Payment
      And the Lender prints the Receipt
      And the Lender records another Payment for the same Customer
      Then the Payment is from "Receiptagain Customer"

  Rule: Voiding a Payment asks for a reason and shows what it changes

    @screen:/payments/:id
    Scenario: The Preview shows the Payment leaving the Ledger before anything is saved
      Given "Previewvoid Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 15 Nov 2025
      When the Lender opens that Payment
      And the Lender starts to void it
      Then the Preview shows what the Mortgage owes today, before and after
      And the Preview lists the Payment on 15 Nov 2025 as a Ledger step removed
      When closes the dialog with its ×
      Then the dialog is closed
      And it has a Receipt
      And it can still be voided

    @screen:/payments/:id
    Scenario: A voided Payment is badged, gives its reason, and hides its Receipt
      Given "Badgevoid Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 15 Nov 2025
      When the Lender opens that Payment
      And the Lender voids it because "Wrong Customer"
      Then it is badged "voided"
      And it shows "Payment of ₹1,000 voided" with the reason "Wrong Customer"
      And it has no Receipt and cannot be voided again

  Rule: The app refuses a Void that would break the Ledger
    The page never offers these; they are asked of the app directly, as any client could.

    Scenario: A Payment already voided can't be voided again
      Given "Twicevoid Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 5 Nov 2025, voided because "Entered twice"
      And today is 15 Nov 2025
      Then voiding that Payment again is refused: "Already voided"

    Scenario: A Closure's Final Payment is voided by reopening the Mortgage
      Given "Finalvoid Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And it was Redeemed on 10 Nov 2025
      And today is 15 Nov 2025
      Then voiding the Payment that Redeemed it is refused: "This is the final Payment of the closing of 2025-Finalvoid-GoldChain: reopen the Mortgage instead, which voids it"

    Scenario: A Payment to a Mortgage that has since closed can't be voided
      Given "Voidclosed Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 5 Oct 2025
      And it was Redeemed on 10 Nov 2025
      And today is 15 Nov 2025
      Then voiding the Payment of ₹1,000 is refused: "2025-Voidclosed-GoldChain is redeemed: reopen it first"

  Rule: The Receipt wording comes from the Receipt template in Settings

    # The template is one setting for the whole book, so this runs on the @fresh app, where no
    # other @fresh scenario reads a Receipt (as collateral.feature does for Gold Rates).
    @fresh @screen:/settings @screen:/payments/:id
    Scenario: A template changed in Settings shows on the next Receipt
      Given "Template Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 15 Nov 2025
      When the Lender changes the Receipt template in Settings to "Dhanyavad {customer_name}: {amount} received by {method}. {mortgages}"
      And the Lender opens that Payment
      Then the WhatsApp preview begins "Dhanyavad Template Customer: ₹1,000 received by Cash."

  Rule: Voiding the Payment that made a Mortgage Dormant makes it owe again
    Dormant is worked out afresh from the Payments (ADR 0012): it appears with back-dated Payments
    and goes when one is voided. A Void never lowers what is owed, so none can leave a Mortgage Dormant.

    @screen:/payments/:id
    Scenario: Voiding a back-dated Payment ends the Dormant state
      Given "Voidowing Customer" was lent ₹1,00,000 on 14 Jan 2026 at 3% a month, simple, with nothing for a part month
      And paid ₹3,000 on it on 15 Apr 2026, entered on 20 Apr 2026
      And paid ₹50,000 on it on 10 Apr 2026, entered on 20 Apr 2026
      And paid ₹56,000 on it on 9 Apr 2026, entered on 20 Apr 2026
      And today is 20 Apr 2026
      Then it is Dormant, owing nothing
      When the Lender opens that Payment
      And the Lender voids it because "Bounced"
      Then it owes again and is no longer Dormant
