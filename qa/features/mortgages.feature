Feature: Mortgages
  The Lender lends against a packet of jewellery, finds a Mortgage in the list, reads its
  page and corrects its details; a correction replays its Ledger.

  @golden @screen:/mortgages
  Rule: The Mortgages list narrows by status, month closed, Customer and filter
    The golden book on 15 Nov 2025: Vikram's coin Redeemed, Anita's bracelet Waived off and
    Rohit's earrings Forfeited, all in November; the rest Active.

    Background:
      Given today is 15 Nov 2025

    Scenario: The list shows the Active Mortgages first
      When the Lender opens the Mortgages list
      Then the Mortgages listed are the Active ones
      And 2025-Ramesh-GoldRing is listed
      And 2025-Vikram-GoldCoin is not listed

    Scenario Outline: The <status> button lists only <status> Mortgages
      When the Lender lists the <status> Mortgages
      Then the Mortgages listed are the <status> ones
      And <listed> is listed
      And <unlisted> is not listed

      Examples:
        | status     | listed                  | unlisted                |
        | Active     | 2025-Ramesh-GoldRing    | 2025-Vikram-GoldCoin    |
        | Redeemed   | 2025-Vikram-GoldCoin    | 2025-Ramesh-GoldRing    |
        | Waived off | 2025-Anita-GoldBracelet | 2025-Vikram-GoldCoin    |
        | Forfeited  | 2025-Rohit-GoldEarrings | 2025-Anita-GoldBracelet |

    Scenario: All lists every status
      When the Lender lists the Mortgages of every status
      Then 2025-Ramesh-GoldRing is listed
      And 2025-Vikram-GoldCoin is listed
      And 2025-Rohit-GoldEarrings is listed

    Scenario: Closed in lists the Mortgages closed that month
      When the Lender lists the Mortgages closed in Nov 2025
      Then 2025-Vikram-GoldCoin is listed
      And 2025-Anita-GoldBracelet is listed
      And 2025-Rohit-GoldEarrings is listed
      And 2025-Ramesh-GoldRing is not listed
      When the Lender lists the Mortgages closed in Sept 2025
      Then the list reads "No Mortgages match."

    Scenario: One Customer's Mortgages, until the Lender shows every Customer
      When the Lender lists the Mortgages of "Ramesh Kumar"
      Then the list notes "Only Ramesh Kumar's Mortgages"
      And every Mortgage listed is for "Ramesh Kumar"
      And 2025-Ramesh-GoldChain is listed
      When the Lender shows every Customer
      Then 2025-Meera-GoldNecklace is listed

    Scenario: The filter finds Mortgages by Customer, and says when none match
      When the Lender filters the Mortgages list by "Meera"
      Then every Mortgage listed is for "Meera Sharma"
      And 2025-Meera-GoldNecklace is listed
      And 2025-Meera-GoldEarrings is listed
      When the Lender filters the Mortgages list by "nobody by this name"
      Then the list reads "No Mortgages match."

    Scenario: A column heading sorts the list, and again reverses it
      When the Lender sorts the Mortgages list by "Principal lent"
      Then the Mortgages are listed by Principal lent, largest first
      When the Lender sorts it by "Principal lent" again
      Then the Mortgages are listed by Principal lent, smallest first

  Rule: The list says when there are none, and comes a page at a time

    @fresh @screen:/mortgages
    Scenario: An empty book has no Mortgages yet
      # No @fresh scenario waives a Mortgage off, so none is listed whatever else they lend.
      When the Lender lists the Waived off Mortgages
      Then the list reads "No Mortgages yet."

    @screen:/mortgages
    Scenario: More than a page of Mortgages comes a page at a time
      Given "Cumin Pager Customer" was lent ₹1,000 on 5 Sept 2025 against 21 Gold rings
      And today is 15 Nov 2025
      When the Lender lists the Mortgages of "Cumin Pager Customer"
      Then the list shows 1–20 of 21, page 1 of 2
      When the Lender turns to the next page
      Then the list shows 21–21 of 21, page 2 of 2

  Rule: A new Mortgage starts from a Customer and confirms what it will owe

    @screen:/mortgages/new
    Scenario: Choosing a Customer shows their Active Mortgages and suggests a Mortgage Name
      Given "Saffron Chooser Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      When the Lender starts a new Mortgage
      And chooses the Customer "Saffron Chooser Customer"
      Then their Active Mortgages list 2025-Saffron-GoldChain
      When the Lender describes the jewellery as "Gold ring"
      Then the Mortgage Name suggested is "2025-Saffron-GoldRing"
      When the Lender describes the jewellery as "Gold chain"
      Then the Mortgage Name suggested is "2025-Saffron-GoldChain-2"
      When the Lender names it "2025-Saffron-Wedding"
      And the Lender describes the jewellery as "Gold bangle"
      Then the Mortgage Name is still "2025-Saffron-Wedding"

    @screen:/mortgages/new @screen:/customers/new
    Scenario: A Customer not yet added is added first
      When the Lender starts a new Mortgage
      And adds the Customer first
      Then the Customer form opens, to return to the new Mortgage

    @screen:/mortgages/new
    Scenario Outline: The new Mortgage form refuses <what>
      Given today is 15 Nov 2025
      And "<customer>" is a Customer
      When the Lender starts a new Mortgage for "<customer>"
      And fills in ₹10,000 against a Gold ring
      And enters <entry>
      Then the new Mortgage cannot be created: its "<field>" is refused

      Examples:
        | what                            | customer              | entry                                                 | field                         |
        | a start date after today        | Clove Date Customer   | a start date of 16 Nov 2025                           | Start date                    |
        | no Principal                    | Mace Amount Customer  | a Principal lent of ₹0                                | Principal lent (₹)            |
        | more gold than the piece weighs | Sumac Weight Customer | a gross weight of 5 grams and a net weight of 6 grams | Net weight, gold only (grams) |

    @screen:/mortgages/new @screen:/mortgages/:id
    Scenario: Photos uploaded with a new Mortgage are on its page
      Given "Fennel Photo Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      When the Lender starts a new Mortgage for "Fennel Photo Customer"
      And fills in ₹10,000 against a Gold ring
      And lends it through UPI
      And uploads 2 photos of it
      And creates the Mortgage
      Then the confirmation lists "Photos" as "2"
      When the Lender confirms
      Then the Mortgage has 2 photos

    @screen:/mortgages/new
    Scenario: Lending in cash at the Cash Limit warns first; just under it does not
      Given "Nutmeg Cash Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      When the Lender starts a new Mortgage for "Nutmeg Cash Customer"
      And fills in ₹10,000 against a Gold ring
      And enters the Cash Limit as the Principal lent, in cash
      And creates the Mortgage
      Then the Lender is warned of the cash
      When the Lender goes back
      Then the new Mortgage is not created
      When the Lender enters ₹1 under the Cash Limit as the Principal lent, in cash
      And creates the Mortgage
      Then the Lender is asked to confirm the new Mortgage

    @screen:/mortgages/new @screen:/mortgages/:id
    Scenario: A back-dated Mortgage's confirmation forecasts what it owes today
      Given "Turmeric Backdated Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      When the Lender starts a new Mortgage for "Turmeric Backdated Customer"
      And fills in ₹30,000 against a Gold ring
      And enters a start date of 5 Sept 2025
      And lends it through UPI
      And creates the Mortgage
      Then the confirmation forecasts it with no Payments
      And the confirmation's Owed today is more than ₹30,000
      When the Lender confirms
      Then the Mortgage's Outstanding is the Owed today it was confirmed with

    @screen:/calculator @screen:/mortgages/new
    Scenario: Lend this carries the Calculator's amount, start date and Terms into a new Mortgage
      Given "Cardamom Lend Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And today is 15 Nov 2025
      When the Lender works out ₹45,000 from 1 Nov 2025 at 2.5% a month on the Calculator
      And lends this
      And chooses the Customer "Cardamom Lend Customer"
      Then the new Mortgage form starts from ₹45,000 on 1 Nov 2025 at 2.5% a month

  Rule: A Mortgage's page shows what it owes, its details and its Ledger

    Background:
      Given today is 15 Nov 2025

    @golden @screen:/mortgages/:id
    Scenario: Its tiles show what it owes today, and its details what was lent
      When the Lender opens 2025-Ramesh-GoldRing
      Then its tiles show what it owes today
      And its details read:
        | Started        | 5 Sept 2025                        |
        | Principal lent | ₹50,000                            |
        | Lent Through   | UPI                                |
        | Jewellery      | Gold ring                          |
        | Weight         | 5.5 grams gross, 5 grams net, 22K |

    @golden @screen:/mortgages/:id
    Scenario Outline: Its Ledger names its <step> step
      When the Lender opens <mortgage>
      Then its Ledger has a step "<reading>"

      Examples:
        | step               | mortgage                | reading                                        |
        | Waived off         | 2025-Anita-GoldBracelet | Waived off: the Lender let off what was left   |
        | Forfeited          | 2025-Rohit-GoldEarrings | Forfeited: the jewellery settles what was owed |
        | Advance Instalment | 2025-Ramesh-GoldRing    | Advance Instalment 2 of 3:                     |

    @golden @screen:/mortgages/:id @screen:/payments/new
    Scenario: Record a Payment starts a Payment with the Mortgage included
      When the Lender opens 2025-Ramesh-GoldRing
      And records a Payment on it
      Then the Payment from "Ramesh Kumar" includes 2025-Ramesh-GoldRing

    @screen:/mortgages/:id
    Scenario: The Ledger shows its latest 8 steps, and the complete Ledger every step of each kind
      Given "Paprika Ledger Customer" was lent ₹30,000 on 5 Sept 2024 against a Gold chain
      And paid ₹1,000 on it on 10 Oct 2024
      And its Terms change to 2% a month from 5 Oct 2025
      When the Lender opens the Mortgage on 15 Nov 2025
      Then its Ledger shows its latest 8 steps
      When the Lender opens the complete Ledger
      Then the complete Ledger shows every step
      And its Ledger has a step "Mortgage started: Principal lent"
      And its Ledger has a step "Interest: "
      And its Ledger has a step "Payment:"
      And its Ledger has a step "Unpaid interest capitalised into Principal"
      And its Ledger has a step "Terms changed: 2% a month"
      And its Ledger has a step "Interest to Date:"

    @screen:/mortgages/:id
    Scenario: A photo added to a Mortgage can be deleted
      Given "Sesame Photo Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      When the Lender opens the Mortgage on 15 Nov 2025
      Then the Mortgage has no photos
      When the Lender adds a photo to it
      Then the Mortgage has 1 photo
      When the Lender deletes its photo
      Then the Mortgage has no photos

  Rule: Editing a Mortgage previews what a correction changes and replays its Ledger

    @screen:/mortgages/:id/edit @screen:/mortgages/:id
    Scenario: Correcting the start date replays the Ledger, and the confirmation lists only that
      Given "Ajwain Edit Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      When the Lender edits the Mortgage on 15 Nov 2025
      And changes its start date to 1 Sept 2025
      Then the edit shows what changes
      When the Lender saves the changes
      Then the confirmation lists only:
        | Start date | 5 Sept 2025 → 1 Sept 2025 |
      When the Lender confirms
      Then its Ledger has a step "1 Sept 2025 Mortgage started: Principal lent"
      And its Ledger has a step "1 Oct 2025 Interest:"

    @screen:/mortgages/:id/edit @screen:/mortgages/:id
    Scenario Outline: Correcting the <detail> shows what changes and replays the Ledger
      Given "<customer>" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      When the Lender edits the Mortgage on 15 Nov 2025
      And changes its <detail> to <value>
      Then the edit shows what changes
      When the Lender saves the changes
      Then the confirmation lists only:
        | <label> | <change> |
      When the Lender confirms
      Then its Ledger has a step "<replayed>"

      Examples:
        | detail         | value        | customer              | label          | change            | replayed                                 |
        | Principal lent | ₹25,000      | Mustard Edit Customer | Principal lent | ₹30,000 → ₹25,000 | Mortgage started: Principal lent ₹25,000 |
        | starting Terms | 2.5% a month | Anise Edit Customer   | Starting Terms | → 2.5% a month    | Interest: 2.5% of ₹30,000                |

    @golden @screen:/mortgages/:id/edit
    Scenario: A closed Mortgage keeps its start date, Principal and Terms
      Given today is 15 Nov 2025
      When the Lender edits 2025-Vikram-GoldCoin
      Then its changes cannot be saved
      And its start date, Principal and Terms are locked
      And its Mortgage Name can still be changed

    @screen:/mortgages/:id/edit
    Scenario: A Mortgage Name already used is refused
      Given "Tamarind Name Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And was also lent ₹10,000 on 5 Sept 2025 against a Gold ring
      When the Lender edits the Mortgage on 15 Nov 2025
      And renames it "2025-Tamarind-GoldChain"
      When the Lender saves the changes
      Then the confirmation lists only:
        | Name | 2025-Tamarind-GoldRing → 2025-Tamarind-GoldChain |
      When the Lender confirms
      Then the edit is refused: "The Mortgage Name 2025-Tamarind-GoldChain is already used"

    @screen:/mortgages/:id/edit
    Scenario: A start date that moves a Term Change off an Accrual Date is refused
      Given "Fenugreek Term Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And its Terms change to 2% a month from 5 Dec 2025
      When the Lender edits the Mortgage on 15 Nov 2025
      And changes its start date to 6 Sept 2025
      Then the edit is refused: "would no longer be on an Accrual Date"
      And its changes cannot be saved

    @screen:/mortgages/:id/edit
    Scenario: A start date after the first Payment is refused
      Given "Coriander Start Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹1,000 on it on 10 Sept 2025
      When the Lender edits the Mortgage on 15 Nov 2025
      And changes its start date to 12 Sept 2025
      Then the edit is refused: "There is a Payment on 10 Sep 2025, before that start date"
      And its changes cannot be saved

    @screen:/mortgages/:id/edit
    Scenario: A correction that would make a Payment more than was owed is refused
      Given "Caraway Overpaid Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold chain
      And paid ₹25,000 on it on 5 Oct 2025
      When the Lender edits the Mortgage on 15 Nov 2025
      And changes its Principal lent to ₹20,000
      Then the edit is refused: "the Payment on 05 Oct 2025 would be more than the"
      And its changes cannot be saved
