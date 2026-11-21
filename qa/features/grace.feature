Feature: Grace Period
  The Grace Period is the few days after an Accrual Date within which a Payment may be dated
  the day before it, as if paid on time, letting off what paying late would have cost. The
  Payment keeps the date it was received and what it let off on each Mortgage. Every figure
  let off is the one the app works out for the draft; the hand-computed figures belong to the
  canonical scenarios.

  Rule: The payment form offers Grace under each ticked Mortgage's last Accrual Date
    A Mortgage started on 5 Sept 2025 accrues on the 5th; the Grace Period is 3 days.

    @screen:/payments/new
    Scenario: The Last Accrual Date is coloured inside and past the Grace Period
      Given "Marigold Shade Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 9 Oct 2025
      When the Lender opens a new Payment from "Marigold Shade Customer"
      Then the Last Accrual Date of 2025-Marigold-GoldChain reads "5 Oct", past the Grace Period
      When the Lender dates the Payment 8 Oct 2025
      Then the Last Accrual Date of 2025-Marigold-GoldChain reads "5 Oct", within the Grace Period
      When the Lender dates the Payment 9 Oct 2025
      Then the Last Accrual Date of 2025-Marigold-GoldChain reads "5 Oct", past the Grace Period

    @screen:/payments/new @screen:/payments/:id/receipt
    Scenario: Dating the Payment the day before the Accrual Date keeps the date received
      Given "Jasmine Offer Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 7 Oct 2025
      When the Lender opens a new Payment from "Jasmine Offer Customer"
      And enters ₹5,000 as the Amount received
      Then the Lender is told Grace lets off something, and to choose a date under Last Accrual Date
      And 2025-Jasmine-GoldChain offers to date it 4 Oct 2025, letting off what the app works out for ₹5,000
      When the Lender chooses to date it 4 Oct 2025 for 2025-Jasmine-GoldChain
      Then the Payment is dated 4 Oct 2025 and received 7 Oct 2025
      When the Lender saves the Payment
      Then the confirmation lists "Dated" at "4 Oct 2025"
      And the confirmation lists "Received" at "7 Oct 2025"
      And the confirmation lists a Grace of what dating ₹5,000 4 Oct 2025 lets off
      When the Lender confirms
      Then the Receipt page opens

    @screen:/payments/new
    Scenario: A date picked by hand clears the Grace choice, and a draft that lets nothing off drops it
      Given "Lotus Draft Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 7 Oct 2025
      When the Lender opens a new Payment from "Lotus Draft Customer"
      And enters ₹5,000 as the Amount received
      And the Lender chooses to date it 4 Oct 2025 for 2025-Lotus-GoldChain
      Then the Payment is dated 4 Oct 2025 and received 7 Oct 2025
      When the Lender dates the Payment 3 Oct 2025
      Then the Payment is dated 3 Oct 2025 with no Grace
      When the Lender dates the Payment 7 Oct 2025
      And the Lender chooses to date it 4 Oct 2025 for 2025-Lotus-GoldChain
      Then the Payment is dated 4 Oct 2025 and received 7 Oct 2025
      When the Lender clears the Amount received
      And enters an Advance of ₹5,000 over 3 months for 2025-Lotus-GoldChain
      Then the Payment is dated 7 Oct 2025 with no Grace
      And Date it 4 Oct 2025 is not offered for 2025-Lotus-GoldChain

    @screen:/payments/new
    Scenario: With Mortgages on different Accrual Dates, the tooltip offers grace both or one only
      Given "Magnolia Pair Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹20,000 on 7 Sept 2025 against a Gold ring
      And today is 8 Oct 2025
      When the Lender opens a new Payment from "Magnolia Pair Customer"
      And enters ₹4,000 as the Amount received
      And the Lender looks at the Grace tip
      Then the Grace tip shows each Mortgage's Accrual Date:
        | 2025-Magnolia-GoldChain | Accrual Date 5 Oct |
        | 2025-Magnolia-GoldRing  | Accrual Date 7 Oct |
      And the Grace tip offers, letting off what the app works out for ₹4,000:
        | To grace the most: Date it 4 Oct · graces both     |
        | Date it 6 Oct · graces 2025-Magnolia-GoldRing only |
      When the Lender chooses to date it 6 Oct 2025 for 2025-Magnolia-GoldRing
      Then the Payment is dated 6 Oct 2025 and received 8 Oct 2025
      When the Lender saves the Payment
      Then the confirmation lists "Dated" at "6 Oct 2025"
      And the confirmation lists "Received" at "8 Oct 2025"
      And the confirmation lists a Grace of what dating ₹4,000 6 Oct 2025 lets off

    @screen:/payments/new @screen:/payments/:id/receipt @screen:/mortgages/:id
    Scenario: With an Advance, the cash takes the earlier date and the Advance is scheduled from the date received
      Given "Orchid Advance Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 7 Oct 2025
      When the Lender opens a new Payment from "Orchid Advance Customer"
      And enters ₹5,000 as the Amount received
      And enters an Advance of ₹1,500 over 3 months for 2025-Orchid-GoldChain
      Then the Amount received is ₹6,500
      When the Lender chooses to date it 4 Oct 2025 for 2025-Orchid-GoldChain
      And the Lender saves the Payment
      Then the confirmation lists a Grace of what dating ₹5,000 4 Oct 2025 lets off
      When the Lender confirms
      Then the Receipt page opens
      And the printable Receipt lists:
        | ₹500 on 5 Nov 2025 |
        | ₹500 on 5 Dec 2025 |
        | ₹500 on 5 Jan 2026 |
      When the Lender opens 2025-Orchid-GoldChain
      Then its Ledger dates its Grace Payment 4 Oct 2025, received 7 Oct 2025, with what it let off
      And it holds an Advance of ₹1,500
      And its parts are:
        | due        | amount | status   |
        | 5 Nov 2025 | ₹500   | Upcoming |
        | 5 Dec 2025 | ₹500   | Upcoming |
        | 5 Jan 2026 | ₹500   | Upcoming |

  Rule: With no Grace Period, the form offers none and past Grace Payments read as before
    The Grace Period is one setting for the whole book, so the scenario's browser reads it
    as none rather than changing it for every scenario running alongside.

    @screen:/payments/new @screen:/payments/:id @screen:/payments/:id/receipt @screen:/customers/:id
    Scenario: No colouring or buttons, and a past Grace Payment unchanged on its Receipt and Favours Given
      Given "Hibiscus Never Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 4 Oct 2025 as a Grace Payment received on 7 Oct 2025
      And today is 7 Oct 2025
      And the Grace Period is set to none
      When the Lender opens a new Payment from "Hibiscus Never Customer"
      Then the Last Accrual Date of 2025-Hibiscus-GoldChain reads "5 Oct", in no colour
      And no Grace is offered
      When the Lender opens that Payment
      Then the Payment page dates it 4 Oct 2025, received 7 Oct 2025, with what it let off
      When the Lender prints the Receipt
      Then the Receipt says it was received on 7 Oct 2025, counted as paid on 4 Oct 2025
      And the Receipt lets off what the Payment did, Mortgage by Mortgage
      When the Lender opens the Customer "Hibiscus Never Customer"
      Then Favours Given lists the Grace of "Gold chain" dated 4 Oct 2025, received 7 Oct 2025, with what it let off

  @golden
  Rule: A Grace Payment shows both its dates and what it let off wherever it appears
    Meera's "grace Meera" Payment on her 2025-Meera-GoldNecklace: received 7 Oct 2025, dated
    4 Oct 2025, in the golden book on its last day.

    Background:
      Given today is 15 Nov 2025

    @screen:/payments
    Scenario: The Payments list badges it
      When the Lender opens the Payments list
      Then the Payment "grace Meera" is marked "Grace"

    @screen:/payments/:id
    Scenario: Its Payment page
      When the Lender opens the Payment "grace Meera"
      Then the Payment page dates it 4 Oct 2025, received 7 Oct 2025, with what it let off

    @screen:/payments/:id/receipt
    Scenario: Its Receipt
      When the Lender opens the Payment "grace Meera"
      And the Lender prints the Receipt
      Then the Receipt says it was received on 7 Oct 2025, counted as paid on 4 Oct 2025
      And the Receipt lets off what the Payment did, Mortgage by Mortgage

    @screen:/mortgages/:id
    Scenario: The Ledger of the Mortgage it was paid to
      When the Lender opens 2025-Meera-GoldNecklace
      Then its Ledger dates its Grace Payment 4 Oct 2025, received 7 Oct 2025, with what it let off

    @screen:/customers/:id
    Scenario: The Customer's Favours Given
      When the Lender opens the Payment "grace Meera"
      And the Lender opens the Customer "Meera Sharma"
      Then Favours Given lists the Grace of "Gold necklace" dated 4 Oct 2025, received 7 Oct 2025, with what it let off

  Rule: The app refuses a Grace Payment it can't take
    The form never offers these; they are asked of the app directly, as any client could.

    Scenario: A Payment received outside the Grace Period can't be dated before the Accrual Date
      Given "Dahlia Late Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 9 Oct 2025
      Then a Payment of ₹1,000 received on 9 Oct 2025 and dated 4 Oct 2025 is refused: "A Payment received on 09 Oct 2025 can't be dated 04 Oct 2025: that is not within the Grace Period"

    Scenario: A Payment that lets nothing off can't be dated before the Accrual Date
      Given "Zinnia Nothing Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 7 Oct 2025
      Then a Payment of only an Advance of ₹1,500 over 3 months received on 7 Oct 2025 and dated 4 Oct 2025 is refused: "Dating it 04 Oct 2025 lets off nothing: record it as an ordinary Payment"
