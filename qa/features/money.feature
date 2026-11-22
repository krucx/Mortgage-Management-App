@unverified-figures
Feature: Money worked out by hand
  The canonical figures: each one here was worked out by hand from the glossary and the
  ADRs, with its arithmetic in a comment beside it, not read off the app. Every other
  scenario checks only that a screen agrees with the data; these check the data itself.
  They stay tagged @unverified-figures until the owner has checked each figure.

  Rules used throughout (Documentation/GLOSSARY.md and the ADRs named):
  - A month's interest is the rate on the Principal as it stood when that month began, at
    the previous Accrual Date, before that day's Payments (ADR 0006).
  - Outstanding is Principal + unpaid interest + the Interest to Date (ADR 0011).
  - A Payment pays unpaid interest, then the Interest to Date (paid ahead of that month's
    interest), then Principal; a Discount does the same after the cash (ADR 0014).
  - The Mortgage page's Unpaid interest tile includes the Interest to Date still owed.

  @screen:/mortgages/:id
  Scenario: Simple interest over several months, a Payment paying interest and then Principal
    Paying Principal on 20 Mar lowers the interest only from the month starting 10 Apr.

    Given "Simple Sums Customer" was lent ₹50,000 on 10 Jan 2025 against a Gold ring at 2% a month, simple, with nothing for a part month
    # 10 Feb: 2% of 50,000 = 1,000; unpaid 1,000
    # 10 Mar: 2% of 50,000 = 1,000; unpaid 2,000
    And paid ₹5,000 on it on 20 Mar 2025
    # 20 Mar: 2,000 to the unpaid interest, the other 5,000 − 2,000 = 3,000 to Principal:
    #         Principal 50,000 − 3,000 = 47,000, unpaid 0
    When the Lender opens the Mortgage on 15 May 2025
    # 10 Apr: the month began 10 Mar on 50,000, so 2% of 50,000 = 1,000; unpaid 1,000
    # 10 May: 2% of 47,000 = 940; unpaid 1,000 + 940 = 1,940
    # 15 May: nothing for a part month, so Outstanding 47,000 + 1,940 = 48,940
    Then its tiles read:
      | Outstanding     | ₹48,940 |
      | Principal       | ₹47,000 |
      | Unpaid interest | ₹1,940  |
    And its Ledger has a step "20 Mar 2025 Payment: ₹2,000 cash to interest, ₹3,000 cash to Principal ₹5,000 ₹0 ₹47,000 ₹0"
    And its Ledger has a step "10 Apr 2025 Interest: 2% of ₹50,000 ₹1,000 — ₹47,000 ₹1,000"
    And its Ledger has a step "10 May 2025 Interest: 2% of ₹47,000 ₹940 — ₹47,000 ₹1,940"

  @screen:/mortgages/:id
  Scenario: Compounded Yearly capitalises what is still unpaid after twelve months
    Given "Yearly Sums Customer" was lent ₹1,00,000 on 1 Feb 2024 against a Gold chain at 1% a month, compounded yearly, with nothing for a part month
    # 1 Mar to 1 Aug 2024: 6 months × (1% of 1,00,000 = 1,000) = 6,000 unpaid
    And paid ₹3,000 on it on 15 Aug 2024
    # 15 Aug: all 3,000 to interest; unpaid 6,000 − 3,000 = 3,000
    When the Lender opens the Mortgage on 10 Mar 2025
    # 1 Sept 2024 to 1 Feb 2025: 6 more months × 1,000; unpaid 3,000 + 6,000 = 9,000
    # 1 Feb 2025 is the 12th Accrual Date: the 9,000 unpaid is capitalised,
    #            Principal 1,00,000 + 9,000 = 1,09,000, unpaid 0
    # 1 Mar 2025: 1% of 1,09,000 = 1,090; unpaid 1,090
    # 10 Mar: Outstanding 1,09,000 + 1,090 = 1,10,090
    Then its tiles read:
      | Outstanding     | ₹1,10,090 |
      | Principal       | ₹1,09,000 |
      | Unpaid interest | ₹1,090    |
    And its Ledger has a step "1 Feb 2025 Interest: 1% of ₹1,00,000 ₹1,000 — ₹1,00,000 ₹9,000"
    And its Ledger has a step "1 Feb 2025 Unpaid interest capitalised into Principal ₹9,000 — ₹1,09,000 ₹0"
    And its Ledger has a step "1 Mar 2025 Interest: 1% of ₹1,09,000 ₹1,090 — ₹1,09,000 ₹1,090"

  @screen:/mortgages/:id
  Scenario Outline: The Part-Month Rule on the Interest to Date: <rule> on <day>
    The month under way began on 5 Oct 2025; its first day and today both count. Pro-rata
    charges each day started out of 30; Full month charges the whole month once it starts.

    Given "<customer>" was lent ₹30,000 on 5 Sept 2025 against a Gold bangle at 3% a month, simple, with <rule> for a part month
    # 5 Oct: 3% of 30,000 = 900 unpaid
    When the Lender opens the Mortgage on <day>
    # Interest to Date: <arithmetic>
    # Outstanding: 30,000 + 900 + <to date> = <outstanding>
    # Unpaid interest tile, the Interest to Date included: 900 + <to date> = <unpaid>
    Then its tiles read:
      | Outstanding     | <outstanding> |
      | Principal       | ₹30,000       |
      | Unpaid interest | <unpaid>      |
    And its Ledger has a step "<day> Interest to Date: <days> of this month, today included (<rule shown>) on ₹30,000, to date: <until> <to date>"

    Examples:
      | customer                | rule         | day         | days    | arithmetic                          | to date | outstanding | unpaid | rule shown      | until                                      |
      | Pro Rata Ten Customer   | pro-rata     | 14 Oct 2025 | 10 days | 5 to 14 Oct is 10 days: 900 × 10/30 | ₹300    | ₹31,200     | ₹1,200 | Pro-rata by day | grows each day until the next Accrual Date |
      | Full Month Ten Customer | a full month | 14 Oct 2025 | 10 days | the whole month: 3% of 30,000       | ₹900    | ₹31,800     | ₹1,800 | Full month      | until the next Accrual Date                |
      | Pro Rata One Customer   | pro-rata     | 5 Oct 2025  | 1 day   | 5 Oct alone is 1 day: 900 × 1/30    | ₹30     | ₹30,930     | ₹930   | Pro-rata by day | grows each day until the next Accrual Date |
      | Full Month One Customer | a full month | 5 Oct 2025  | 1 day   | the whole month from its first day  | ₹900    | ₹31,800     | ₹1,800 | Full month      | until the next Accrual Date                |

  @screen:/mortgages/:id
  Scenario: A Term Change mid-life charges the new rate only on the months from its date
    Given "Mid Life Terms Customer" was lent ₹40,000 on 5 June 2025 against a Gold necklace at 2% a month, simple, with nothing for a part month
    And on 1 July 2025 its Terms were changed to 3% a month from 5 Aug 2025
    When the Lender opens the Mortgage on 10 Oct 2025
    # 5 July: the month from 5 June, at 2%: 2% of 40,000 = 800; unpaid 800
    # 5 Aug:  the month from 5 July, still at 2%: 800; unpaid 1,600
    # 5 Sept: the month from 5 Aug, at 3%: 3% of 40,000 = 1,200; unpaid 2,800
    # 5 Oct:  1,200; unpaid 4,000
    # 10 Oct: Outstanding 40,000 + 4,000 = 44,000
    Then its tiles read:
      | Outstanding     | ₹44,000 |
      | Principal       | ₹40,000 |
      | Unpaid interest | ₹4,000  |
    And its Ledger has a step "5 Aug 2025 Interest: 2% of ₹40,000 ₹800 — ₹40,000 ₹1,600"
    And its Ledger has a step "5 Sept 2025 Interest: 3% of ₹40,000 ₹1,200 — ₹40,000 ₹2,800"
    And its Ledger has a step "5 Oct 2025 Interest: 3% of ₹40,000 ₹1,200 — ₹40,000 ₹4,000"

  @screen:/mortgages/:id
  Scenario: A Grace Payment lets off what paying late would have cost
    Received on 7 Sept, 2 days after the 5 Sept Accrual Date and within the 3-day Grace
    Period, the Payment is dated 4 Sept, the day before. What it lets off is what the
    Mortgage would owe on 7 Sept paid then, less what it owes paid on 4 Sept.

    Given "Grace Sums Customer" was lent ₹50,000 on 5 Aug 2025 against a Gold anklet at 2% a month, compounded monthly, with a full month for a part month
    And paid ₹1,000 on it on 4 Sept 2025 as a Grace Payment received on 7 Sept 2025
    # Dated 4 Sept: the Interest to Date of the month from 5 Aug is the full month,
    #   2% of 50,000 = 1,000, which the 1,000 pays ahead.
    #   5 Sept: that month's 1,000 is charged, all of it paid ahead: unpaid 0, nothing capitalised.
    #   7 Sept: Interest to Date of the month from 5 Sept: 2% of 50,000 = 1,000;
    #   Outstanding 50,000 + 1,000 = 51,000.
    # Paid late on 7 Sept instead: 5 Sept charges 1,000, unpaid and capitalised,
    #   Principal 51,000; the Interest to Date is 2% of 51,000 = 1,020, the 1,000 pays
    #   1,000 of it ahead; Outstanding 51,000 + 20 = 51,020.
    # Let off: 51,020 − 51,000 = 20
    # Unpaid interest tile, the Interest to Date included: 0 + 1,000 = 1,000
    When the Lender opens the Mortgage on 7 Sept 2025
    Then its tiles read:
      | Outstanding     | ₹51,000 |
      | Principal       | ₹50,000 |
      | Unpaid interest | ₹1,000  |
    And its Ledger has a step "4 Sept 2025 · received 7 Sept 2025 · Grace, ₹20 let off Payment: ₹1,000 cash to interest, ₹0 cash to Principal ₹1,000 ₹0 ₹50,000 ₹0"
    And its Ledger has a step "5 Sept 2025 Interest: 2% of ₹50,000, ₹1,000 of it paid ahead ₹1,000 — ₹50,000 ₹0"

  @screen:/mortgages/:id @screen:/payments/:id @screen:/payments/:id/receipt
  Scenario: A Discount pays after the cash: unpaid interest, the Interest to Date, then Principal
    Given "Discount Order Customer" was lent ₹20,000 on 5 Sept 2025 against a Gold chain at 3% a month, simple, with a full month for a part month
    # 5 Oct: 3% of 20,000 = 600 unpaid
    And paid ₹400 with a Discount of ₹1,000 on it on 20 Oct 2025
    # 20 Oct: the cash first: 400 to the unpaid interest, leaving 600 − 400 = 200.
    #   Then the Discount: 200 to the unpaid interest; 600 to the Interest to Date (the
    #   full month from 5 Oct, 3% of 20,000), paid ahead; the other 1,000 − 200 − 600 =
    #   200 to Principal: Principal 20,000 − 200 = 19,800.
    #   Discount to interest 200 + 600 = 800; still owed 19,800 (its month paid ahead).
    When the Lender opens that Payment
    And the Lender prints the Receipt
    Then the printable Receipt has the line "Gold chain ₹400 ₹400 ₹0 ₹1,000 ₹800 ₹200 ₹19,800"
    When the Lender opens the Mortgage on 10 Nov 2025
    # 5 Nov: the month from 5 Oct began on 20,000: 3% of 20,000 = 600, all paid ahead; unpaid 0
    # 10 Nov: Interest to Date, the full month from 5 Nov: 3% of 19,800 = 594
    #   Outstanding 19,800 + 0 + 594 = 20,394
    # Unpaid interest tile, the Interest to Date included: 0 + 594 = 594
    Then its tiles read:
      | Outstanding     | ₹20,394 |
      | Principal       | ₹19,800 |
      | Unpaid interest | ₹594    |
    And its Ledger has a step "20 Oct 2025 Payment: ₹400 cash to interest, ₹0 cash to Principal; ₹800 Discount to interest, ₹200 Discount to Principal ₹400 ₹1,000 ₹19,800 ₹0"
    And its Ledger has a step "5 Nov 2025 Interest: 3% of ₹20,000, ₹600 of it paid ahead ₹600 — ₹19,800 ₹0"

  @screen:/mortgages/:id
  Scenario: Advance Instalments land on Accrual Dates, the first falling short
    Each part pays the oldest unpaid interest first (ADR 0021).

    Given "Advance Sums Customer" was lent ₹30,000 on 5 Aug 2025 against a Gold pendant at 3% a month, simple, with nothing for a part month
    # 5 Sept: 3% of 30,000 = 900 unpaid
    And paid an Advance of ₹2,700 over 2 months on it on 10 Sept 2025
    # Parts: 2,700 / 2 = 1,350 on each of the next two Accrual Dates, 5 Oct and 5 Nov
    When the Lender opens the Mortgage on 20 Oct 2025
    # 5 Oct: 900 charged, unpaid 900 + 900 = 1,800; then the first part of 1,350 falls
    #   short of it: unpaid 1,800 − 1,350 = 450. Advance held: the 1,350 still to come.
    #   Outstanding 30,000 + 450 = 30,450
    Then its tiles read:
      | Outstanding     | ₹30,450 |
      | Principal       | ₹30,000 |
      | Unpaid interest | ₹450    |
      | Advance held    | ₹1,350  |
    And its Ledger has a step "5 Oct 2025 Advance Instalment 1 of 2: ₹1,350 cash to interest, ₹0 cash to Principal ₹1,350 ₹0 ₹30,000 ₹450"
    When the Lender opens the Mortgage on 10 Nov 2025
    # 5 Nov: 900 charged, unpaid 450 + 900 = 1,350; the second part of 1,350 pays it all
    #   Outstanding 30,000; nothing held
    Then its tiles read:
      | Outstanding     | ₹30,000 |
      | Principal       | ₹30,000 |
      | Unpaid interest | ₹0      |
      | Advance held    | ₹0      |
    And its Ledger has a step "5 Nov 2025 Advance Instalment 2 of 2: ₹1,350 cash to interest, ₹0 cash to Principal ₹1,350 ₹0 ₹30,000 ₹0"

  @screen:/payments/:id @screen:/payments/:id/receipt
  Scenario: One Payment split across three Mortgages
    Given "Three Way Customer" was lent ₹10,000 on 5 Sept 2025 against a Gold ring at 3% a month, simple, with nothing for a part month
    And was also lent ₹20,000 on 5 Sept 2025 against a Gold chain at 3% a month, simple, with nothing for a part month
    And was also lent ₹30,000 on 5 Sept 2025 against a Gold bangle at 3% a month, simple, with nothing for a part month
    # 5 Oct: 3% of each: 300, 600 and 900 unpaid
    And paid ₹12,000 on 10 Oct 2025, allocated:
      | Gold ring   | ₹300   |
      | Gold chain  | ₹2,600 |
      | Gold bangle | ₹9,100 |
    # 300 + 2,600 + 9,100 = 12,000
    # Ring:   300 to interest, 0 to Principal; still owed 10,000
    # Chain:  600 to interest, 2,600 − 600 = 2,000 to Principal; still owed 20,000 − 2,000 = 18,000
    # Bangle: 900 to interest, 9,100 − 900 = 8,200 to Principal; still owed 30,000 − 8,200 = 21,800
    # Still owed in all: 10,000 + 18,000 + 21,800 = 49,800
    When the Lender opens that Payment
    And the Lender prints the Receipt
    Then the printable Receipt has the line "Gold ring ₹300 ₹300 ₹0 ₹0 ₹0 ₹0 ₹10,000"
    And the printable Receipt has the line "Gold chain ₹2,600 ₹600 ₹2,000 ₹0 ₹0 ₹0 ₹18,000"
    And the printable Receipt has the line "Gold bangle ₹9,100 ₹900 ₹8,200 ₹0 ₹0 ₹0 ₹21,800"
    And the printable Receipt has the line "Total ₹12,000 ₹0 ₹49,800"

  @screen:/mortgages/:id
  Scenario: Redeeming with an Advance held: the upcoming part is applied first
    A Closure cancels the upcoming parts, applying them at once, before the final Payment.

    Given "Redeem Advance Customer" was lent ₹30,000 on 5 Sept 2025 against a Gold bracelet at 3% a month, simple, with a full month for a part month
    And paid an Advance of ₹1,800 over 2 months on it on 10 Sept 2025
    # Parts: 1,800 / 2 = 900 on 5 Oct and 900 on 5 Nov
    # 5 Oct: 3% of 30,000 = 900 charged, and the first part pays it: unpaid 0
    When the Lender opens the Mortgage on 20 Oct 2025
    And the Lender starts to redeem it
    # 20 Oct: Interest to Date, the full month from 5 Oct: 3% of 30,000 = 900
    #   Outstanding 30,000 + 0 + 900 = 30,900; the 900 part due 5 Nov is held,
    #   so to pay 30,900 − 900 = 30,000
    Then the Closure quote reads:
      | Principal                   | ₹30,000   |
      | Unpaid interest             | ₹0        |
      | Interest to Date            | ₹900      |
      | Outstanding on 20 Oct 2025  | ₹30,900   |
      | Advance held                | − ₹900    |
      | To pay                      | ₹30,000   |
    When the Lender redeems it with a final Payment by UPI
    Then its Closure reads "Redeemed on 20 Oct 2025, paying its Outstanding of ₹30,900, ₹900 of it from the Advance held."
    And its tiles read:
      | Outstanding     | ₹0 |
      | Principal       | ₹0 |
      | Unpaid interest | ₹0 |

  @screen:/mortgages/:id
  Scenario: Waiving off lets off what the final Payment leaves of the Outstanding
    Given "Waive Sums Customer" was lent ₹20,000 on 5 Sept 2025 against a Gold bracelet at 3% a month, simple, with a full month for a part month
    # 5 Oct: 3% of 20,000 = 600 unpaid
    And it was Waived off on 20 Oct 2025 with ₹15,000 received
    # 20 Oct: Interest to Date, the full month from 5 Oct: 3% of 20,000 = 600
    #   Outstanding 20,000 + 600 + 600 = 21,200; Waived Amount 21,200 − 15,000 = 6,200
    When the Lender opens the Mortgage on 25 Oct 2025
    Then its Closure lists "Outstanding on the Closure date" at "₹21,200"
    And its Closure lists "Final Payment" at "₹15,000 (receipt)"
    And its Closure lists "Waived off" at "₹6,200"
    # Closed, it owes nothing
    And its tiles read:
      | Outstanding     | ₹0 |
      | Principal       | ₹0 |
      | Unpaid interest | ₹0 |
