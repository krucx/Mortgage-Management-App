Feature: Closures
  A Mortgage is closed by a Redemption, and a closed one can be reopened.

  @screen:/mortgages/:id
  Scenario: A Redemption uses the upcoming Advance, and Reopen restores it
    Given "Redeem Customer" was lent ₹60,000 on 5 Sept 2025 against a Gold necklace
    And paid an Advance of ₹2,000 over 2 months on it on 15 Nov 2025
    When the Lender opens the Mortgage on 15 Nov 2025
    Then it holds an Advance of ₹2,000
    When the Lender starts to redeem it
    Then the Redemption takes off the ₹2,000 Advance held
    # UPI: the final Payment is over the cash limit.
    When the Lender redeems it with a final Payment by UPI
    Then its Closure reads "Redeemed on 15 Nov 2025"
    And its Closure reads "₹2,000 of it from the Advance held"
    When the Lender reopens it because "Redeemed by mistake"
    Then it is Active
    And it holds an Advance of ₹2,000
    And its parts are:
      | due        | amount | status   |
      | 5 Dec 2025 | ₹1,000 | Upcoming |
      | 5 Jan 2026 | ₹1,000 | Upcoming |

  @screen:/mortgages/:id
  Scenario: A Waiver can't carry an Advance
    Given "Waive Customer" was lent ₹60,000 on 5 Sept 2025 against a Gold necklace
    And paid an Advance of ₹2,000 over 2 months on it on 15 Nov 2025
    When the Lender opens the Mortgage on 15 Nov 2025
    Then waiving it with an Advance is refused

  Rule: The quote shows what closing on the chosen date takes
    Figures are asserted as what the app works out for that date, not worked out by hand.

    @screen:/mortgages/:id
    Scenario: The quote follows the closed-on date, and takes off the Advance held
      Given "Quote Customer" was lent ₹60,000 on 5 Sept 2025 against a Gold necklace
      And paid an Advance of ₹2,000 over 2 months on it on 15 Nov 2025
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to redeem it
      Then the quote is what the app works out for 15 Nov 2025
      When the Lender chooses 20 Nov 2025 as the Closure date
      Then the quote is what the app works out for 20 Nov 2025
      And the quote shows an Advance held to take off, and what is left "To pay"

  Rule: A Redemption pays the Outstanding in a final Payment

    @screen:/mortgages/:id @screen:/payments/:id
    Scenario: Redeem by UPI with a reference, backdated, and open its Final Payment receipt
      Given "Redeemer Customer" was lent ₹60,000 on 5 Sept 2025 against a Gold necklace
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to redeem it
      And the Lender chooses 12 Nov 2025 as the Closure date
      And pays the final Payment by UPI with the reference "UPI-460-REDEEM"
      And the Lender saves the Closure
      Then the confirmation lists "Redeemed on" at "12 Nov 2025"
      And the confirmation lists "Method" at "UPI · UPI-460-REDEEM"
      When the Lender confirms the Closure
      Then its Closure reads "Redeemed on 12 Nov 2025"
      When the Lender opens its Final Payment from the Closure
      Then it has a Receipt
      And the Payment is of what the Closure paid

    @screen:/mortgages/:id
    Scenario: A cash final Payment at the Cash Limit asks first
      Given "Cashlimit Customer" was lent ₹60,000 on 5 Sept 2025 against a Gold necklace
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to redeem it
      And the Lender saves the Closure
      Then the Lender is warned of the final Payment in cash
      When the Lender goes back
      Then the dialog is closed
      And it is Active

  Rule: A Waiver lets off what is left after the Customer pays part, or none

    @screen:/mortgages/:id @screen:/customers/:id
    Scenario: Waive off with nothing received, with a reason
      Given "Waiveall Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to waive it off
      And the Lender enters ₹0 as received now
      Then the Waived off amount is what the Outstanding leaves after what is received
      When the Lender gives "Small business hardship" as the reason
      And the Lender saves the Closure
      Then the confirmation says "Return the jewellery to Waiveall Customer."
      And the confirmation lists "Final Payment" at "None"
      When the Lender confirms the Closure
      Then its Closure reads "Waived off on 15 Nov 2025"
      And its Closure reads "Small business hardship"
      And its Closure lists "Final Payment" at "None"
      When the Lender opens the Customer "Waiveall Customer"
      Then their Favours Given lists the Waived Amount on the "Gold chain"

    @screen:/mortgages/:id @screen:/payments/:id @screen:/customers/:id
    Scenario: Waive off with part received links the final Payment's receipt
      Given "Waivepart Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to waive it off
      And the Lender enters ₹1,000 as received now
      Then the Waived off amount is what the Outstanding leaves after what is received
      When the Lender gives "Part paid, rest let off" as the reason
      And the Lender saves the Closure
      And the Lender confirms the Closure
      Then its Closure reads "Waived off on 15 Nov 2025"
      When the Lender opens its Final Payment from the Closure
      Then the Payment is of what the Closure paid
      When the Lender opens the Customer "Waivepart Customer"
      Then their Favours Given lists the Waived Amount on the "Gold chain"

  Rule: A Forfeiture records what the jewellery recovered

    @screen:/mortgages/:id
    Scenario: Forfeit with a loss, then a profit, and a note
      Given "Forfeiter Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to forfeit it
      And the Lender enters ₹10,000 as the Recovered Amount
      Then the result reads as a loss, as the app works it out
      When the Lender enters ₹90,000 as the Recovered Amount
      Then the result reads as a profit, as the app works it out
      When the Lender gives "Sold to a dealer" as the note
      And the Lender saves the Closure
      And the Lender confirms the Closure
      Then its Closure reads "Forfeited on 15 Nov 2025"
      And its Closure reads "Sold to a dealer"
      And its Closure reads "Profit of"

  Rule: Reopening undoes the Closure, as the Preview shows

    @screen:/mortgages/:id @screen:/payments/:id
    Scenario: Reopening a Redemption voids its final Payment
      Given "Reopenred Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And it was Redeemed on 15 Nov 2025
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender notes its Final Payment
      And the Lender starts to reopen it
      Then the Reopen Preview says its final Payment is voided
      When the Lender reopens it giving the reason "Redeemed by mistake"
      Then it is Active
      Then its final Payment is voided with the reason "Redeemed by mistake"

    @screen:/mortgages/:id @screen:/payments/:id @screen:/customers/:id
    Scenario: Reopening a Waiver voids its final Payment and removes its Waived Amount from Favours Given
      Given "Reopenwai Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And it was Waived off on 15 Nov 2025 with ₹1,000 received
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender notes its Final Payment
      And the Lender starts to reopen it
      Then the Reopen Preview says its final Payment is voided
      When the Lender reopens it giving the reason "Waived by mistake"
      Then it is Active
      Then its final Payment is voided with the reason "Waived by mistake"
      When the Lender opens the Customer "Reopenwai Customer"
      Then their page lists no Favours Given

    @screen:/mortgages/:id
    Scenario: Reopening a Forfeiture has no final Payment to void
      Given "Reopenfor Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And it was Forfeited on 15 Nov 2025 recovering ₹5,000
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to reopen it
      Then the Reopen Preview has no final Payment to void
      When the Lender reopens it giving the reason "Forfeited by mistake"
      Then it is Active

  Rule: The Closure form shows why a date can't be used, and keeps Save off

    @screen:/mortgages/:id
    Scenario: A future date
      Given "Futureclose Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to redeem it
      And the Lender chooses 16 Nov 2025 as the Closure date
      Then the Closure is refused: "A Redemption, Waiver or Forfeiture cannot be recorded for a future date"

    @screen:/mortgages/:id
    Scenario: A date before the Mortgage started
      Given "Beforestart Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to redeem it
      And the Lender chooses 4 Sept 2025 as the Closure date
      Then the Closure is refused: "2025-Beforestart-GoldChain had not started on that date"

    @screen:/mortgages/:id
    Scenario: A date before a Payment
      Given "Closelater Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 10 Nov 2025
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to redeem it
      And the Lender chooses 8 Nov 2025 as the Closure date
      Then the Closure is refused: "There are Payments after that date (latest 10 Nov 2025); close it on or after then"

    @screen:/mortgages/:id
    Scenario: Waive off when everything is paid, so Redeem instead
      Given "Waiveeverything Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender starts to waive it off
      And the Lender enters what is owed as received now
      Then the Closure is refused saying what is owed is covered, to Redeem it instead

  Rule: The app refuses a Closure it can't carry out
    The form never offers these; they are asked of the app directly, as any client could.

    Scenario: A closed Mortgage can't be closed again
      Given "Closedtwice Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And it was Redeemed on 15 Nov 2025
      And today is 15 Nov 2025
      Then redeeming it on 15 Nov 2025 is refused: "2025-Closedtwice-GoldChain is already redeemed"

  Rule: The Redeem page goes straight into Redeem

    @screen:/mortgages/:id/redeem
    Scenario: Redeem a Mortgage from its own page
      Given "Redeempage Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender opens its Redeem page
      Then the Redeem page is for redeeming it
      When the Lender redeems it with a final Payment by UPI
      Then its Closure reads "Redeemed on 15 Nov 2025"

    @screen:/mortgages/:id/redeem
    Scenario: The Redeem page of a closed Mortgage says so
      Given "Redeemclosed Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And it was Redeemed on 15 Nov 2025
      When the Lender opens the Mortgage on 15 Nov 2025
      And the Lender opens its Redeem page
      Then the Redeem page says "This Mortgage is already redeemed."
