"""Changes to Mortgages and Payments, straight against the database: each is refused,
written, replayed and recorded in History in one place (today is 20 Apr 2026).

The Mortgage throughout: ₹1,00,000 at 3% a month, Simple, Full-month rule, from
14 Jan 2026, so ₹3,000 of interest on each Accrual Date and ₹1,09,000 owed today.
"""

from datetime import date, datetime

import pytest
from conftest import TODAY
from fastapi import HTTPException
from seed import LAKH, RUPEE, add_customer, add_mortgage, add_payment, forfeit, redeem
from sqlalchemy.engine import Connection

from mortgage_backend.lending import changes
from mortgage_backend.lending.changes import AllocationIn, PaymentIn, TermChangeIn
from mortgage_backend.lending.mortgages import MortgageEdit, MortgageIn
from mortgage_backend.lending.replay import replay
from mortgage_backend.safekeeping.audit import mortgage_history

NOW = datetime(2026, 4, 20, 11, 0)


def payment(customer_id: int, on: str, **allocations: int) -> PaymentIn:
    return PaymentIn(
        customer_id=customer_id,
        paid_on=date.fromisoformat(on),
        amount=sum(allocations.values()),
        method="cash",
        allocations=[
            AllocationIn(mortgage_id=int(m), amount=a) for m, a in allocations.items()
        ],
    )


def refusal(error: pytest.ExceptionInfo[HTTPException]) -> tuple[int, str]:
    return error.value.status_code, str(error.value.detail)


def test_a_payment_is_written_replayed_and_recorded(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)

    payment_id = changes.record_payment(
        conn, payment(ramesh, "2026-04-15", **{str(chain): 5_000 * RUPEE}), TODAY, NOW
    )

    assert replay(conn, chain).outstanding(TODAY).total == 1_04_000 * RUPEE
    created = [e for e in mortgage_history(conn, chain) if e.entity == "payment"]
    assert {(e.entity_id, e.action, e.field, e.new_value) for e in created} >= {
        (payment_id, "created", "amount", str(5_000 * RUPEE))
    }


def test_a_payment_to_a_closed_mortgage_is_refused(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    forfeit(conn, chain, date(2026, 4, 14))

    with pytest.raises(HTTPException) as error:
        changes.record_payment(
            conn, payment(ramesh, "2026-04-10", **{str(chain): RUPEE}), TODAY, NOW
        )

    assert refusal(error) == (409, "2026-Ramesh-Chain is forfeited: reopen it first")


def test_a_payment_larger_than_what_is_owed_is_refused(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)

    with pytest.raises(HTTPException) as error:
        changes.record_payment(
            conn,
            payment(ramesh, "2026-02-20", **{str(chain): 1_10_000 * RUPEE}),
            TODAY,
            NOW,
        )

    assert refusal(error) == (
        422,
        "2026-Ramesh-Chain: the Payment on 20 Feb 2026 would be more than the "
        "₹1,03,000 owed then",
    )


def test_a_back_dated_payment_that_breaks_a_later_one_is_refused(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    # Paid off on 15 Mar: ₹1,00,000 + ₹6,000.
    add_payment(conn, ramesh, date(2026, 3, 15), {chain: 1_06_000 * RUPEE})

    with pytest.raises(HTTPException) as error:
        changes.record_payment(
            conn,
            payment(ramesh, "2026-02-20", **{str(chain): 1_000 * RUPEE}),
            TODAY,
            NOW,
        )

    # After ₹1,000 on 20 Feb only ₹1,05,000 is owed on 14 Mar.
    assert refusal(error) == (
        422,
        "2026-Ramesh-Chain: the Payment on 15 Mar 2026 would be more than the "
        "₹1,05,000 owed then",
    )


def test_voiding_a_payment_takes_it_out_of_the_ledger_and_records_why(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    paid = add_payment(conn, ramesh, date(2026, 4, 15), {chain: 5_000 * RUPEE})

    changes.void_payment(conn, paid, "Typed the wrong amount", TODAY, NOW)

    assert replay(conn, chain).outstanding(TODAY).total == 1_09_000 * RUPEE
    voided = [e for e in mortgage_history(conn, chain) if e.action == "voided"]
    assert [(e.entity_id, e.new_value) for e in voided] == [
        (paid, "Typed the wrong amount")
    ]


def test_a_redemptions_final_payment_is_voided_only_by_reopening(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    # Redeemed on the 14 Mar Accrual Date: its final Payment is ₹1,06,000.
    final = redeem(conn, chain, date(2026, 3, 14))
    assert final is not None
    assert replay(conn, chain).steps_by_payment()[final].amount == 1_06_000 * RUPEE

    with pytest.raises(HTTPException) as error:
        changes.void_payment(conn, final, "mistake", TODAY, NOW)

    assert error.value.status_code == 409
    assert "reopen" in str(error.value.detail)


def test_a_payment_to_a_closed_mortgage_is_voided_only_after_reopening(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    paid = add_payment(conn, ramesh, date(2026, 2, 20), {chain: 1_000 * RUPEE})
    forfeit(conn, chain, date(2026, 4, 14))

    with pytest.raises(HTTPException) as error:
        changes.void_payment(conn, paid, "mistake", TODAY, NOW)

    assert refusal(error) == (409, "2026-Ramesh-Chain is forfeited: reopen it first")


def test_a_term_change_on_a_closed_mortgage_is_refused(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    forfeit(conn, chain, date(2026, 4, 14))

    with pytest.raises(HTTPException) as error:
        changes.add_term_change(
            conn, chain, TermChangeIn(monthly_rate_bps=200), TODAY, NOW
        )

    assert refusal(error) == (409, "2026-Ramesh-Chain is forfeited: reopen it first")


def test_a_term_change_is_written_and_recorded(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    changes.add_term_change(conn, chain, TermChangeIn(monthly_rate_bps=200), TODAY, NOW)

    assert replay(conn, chain).terms_on(date(2026, 5, 14)).monthly_rate_bps == 200
    added = [
        e for e in mortgage_history(conn, chain) if e.action == "term_change_added"
    ]
    assert {(e.field, e.new_value) for e in added} == {
        ("effective_on", "2026-05-14"),
        ("monthly_rate_bps", "200"),
    }


def edit(**overrides: object) -> MortgageEdit:
    return MortgageEdit.model_validate(
        {
            "name": "2026-Ramesh-Chain",
            "start_date": date(2026, 1, 14),
            "amount_lent": LAKH,
            "description": "Gold chain",
            "gross_weight_mg": 20_000,
            "net_weight_mg": 19_000,
            "purity_karat": 22,
            **overrides,
        }
    )


def test_an_edit_that_would_make_a_payment_too_large_is_refused(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    add_payment(conn, ramesh, date(2026, 3, 15), {chain: 1_06_000 * RUPEE})

    with pytest.raises(HTTPException) as error:
        changes.edit_mortgage(conn, chain, edit(amount_lent=50_000 * RUPEE), TODAY, NOW)

    # Lent ₹50,000: only ₹53,000 owed on 15 Mar.
    assert refusal(error) == (
        422,
        "2026-Ramesh-Chain: the Payment on 15 Mar 2026 would be more than the "
        "₹53,000 owed then",
    )


def test_an_edit_is_written_and_recorded(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    changes.edit_mortgage(conn, chain, edit(amount_lent=90_000 * RUPEE), TODAY, NOW)

    assert replay(conn, chain).outstanding(TODAY).total == (90_000 + 8_100) * RUPEE
    edited = [e for e in mortgage_history(conn, chain) if e.action == "edited"]
    assert [(e.field, e.old_value, e.new_value) for e in edited] == [
        ("amount_lent", str(LAKH), str(90_000 * RUPEE))
    ]


@pytest.mark.parametrize(
    ("change", "code", "why"),
    [
        (
            TermChangeIn(effective_on=date(2026, 5, 15), monthly_rate_bps=200),
            422,
            "not an Accrual Date",
        ),
        (
            TermChangeIn(effective_on=date(2026, 4, 14), monthly_rate_bps=200),
            422,
            "in the past",
        ),
        (TermChangeIn(monthly_rate_bps=300), 422, "changes nothing"),
    ],
)
def test_a_term_change_is_refused_when_it_cannot_apply(
    conn: Connection, change: TermChangeIn, code: int, why: str
) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    with pytest.raises(HTTPException) as error:
        changes.add_term_change(conn, chain, change, TODAY, NOW)

    assert error.value.status_code == code, why


def test_only_one_term_change_starts_on_a_date(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    changes.add_term_change(conn, chain, TermChangeIn(monthly_rate_bps=200), TODAY, NOW)

    with pytest.raises(HTTPException) as error:
        changes.add_term_change(
            conn, chain, TermChangeIn(monthly_rate_bps=250), TODAY, NOW
        )

    assert refusal(error) == (409, "There is already a Term Change on 14 May 2026")


def test_an_edit_is_refused_when_its_details_cannot_stand(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    add_mortgage(conn, ramesh, suffix="Bangle")
    add_payment(conn, ramesh, date(2026, 2, 20), {chain: 1_000 * RUPEE})

    def refused(**overrides: object) -> tuple[int, str]:
        with pytest.raises(HTTPException) as error:
            changes.edit_mortgage(conn, chain, edit(**overrides), TODAY, NOW)
        return refusal(error)

    assert refused(start_date=date(2026, 5, 1))[0] == 422  # in the future
    assert refused(name="2026-ramesh-bangle") == (
        409,
        "The Mortgage Name 2026-ramesh-bangle is already used",
    )
    assert refused(start_date=date(2026, 2, 21)) == (
        422,
        "There is a Payment on 20 Feb 2026, before that start date",
    )


def test_an_edit_cannot_strand_a_term_change(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    changes.add_term_change(conn, chain, TermChangeIn(monthly_rate_bps=200), TODAY, NOW)

    with pytest.raises(HTTPException) as error:
        changes.edit_mortgage(
            conn, chain, edit(start_date=date(2026, 1, 15)), TODAY, NOW
        )

    assert error.value.status_code == 422
    assert "Term Change from 14 May 2026" in str(error.value.detail)


def test_a_closed_mortgages_start_and_principal_are_locked(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    forfeit(conn, chain, date(2026, 4, 14))

    with pytest.raises(HTTPException) as error:
        changes.edit_mortgage(conn, chain, edit(amount_lent=90_000 * RUPEE), TODAY, NOW)
    changes.edit_mortgage(conn, chain, edit(description="Two gold chains"), TODAY, NOW)

    assert error.value.status_code == 409
    assert replay(conn, chain).row["description"] == "Two gold chains"


def test_a_refused_change_records_no_history(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    add_payment(conn, ramesh, date(2026, 3, 15), {chain: 1_06_000 * RUPEE})

    with pytest.raises(HTTPException):
        changes.edit_mortgage(conn, chain, edit(amount_lent=50_000 * RUPEE), TODAY, NOW)

    # History is written only once the replay holds (the caller rolls back the rest).
    assert [e for e in mortgage_history(conn, chain) if e.action == "edited"] == []


def redeem_in(on: str = "2026-04-20") -> changes.RedeemIn:
    return changes.RedeemIn(
        redeemed_on=date.fromisoformat(on), method="cash", reference="UTR1"
    )


def test_redeeming_records_the_final_payment_closes_and_is_recorded(
    conn: Connection,
) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    changes.redeem(conn, chain, redeem_in(), TODAY, NOW)

    mortgage = replay(conn, chain)
    final = mortgage.row["redemption_payment_id"]
    assert (mortgage.row["status"], mortgage.row["closed_on"]) == ("redeemed", TODAY)
    # ₹1,09,000 owed plus a Full-month charge of ₹3,000 for the part-month.
    assert [(a.payment_id, a.amount) for a in mortgage.allocations] == [
        (final, 1_12_000 * RUPEE)
    ]
    assert mortgage.outstanding(TODAY).total == 0
    history = {(e.entity, e.entity_id, e.action) for e in mortgage_history(conn, chain)}
    assert {("payment", final, "created"), ("mortgage", chain, "redeemed")} <= history


@pytest.mark.parametrize(
    ("on", "detail"),
    [
        ("2026-04-21", "cannot be recorded for a future date"),
        ("2026-01-13", "had not started on that date"),
        ("2026-03-01", "There are Payments after that date (latest 15 Mar 2026)"),
    ],
)
def test_a_redemption_is_refused_on_a_date_it_cannot_close(
    conn: Connection, on: str, detail: str
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    add_payment(conn, ramesh, date(2026, 3, 15), {chain: 1_000 * RUPEE})

    with pytest.raises(HTTPException) as error:
        changes.redeem(conn, chain, redeem_in(on), TODAY, NOW)

    assert detail in str(error.value.detail)
    assert replay(conn, chain).row["status"] == "active"


def test_a_closed_mortgage_cannot_be_closed_again(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    forfeit(conn, chain, date(2026, 4, 14))

    with pytest.raises(HTTPException) as error:
        changes.redeem(conn, chain, redeem_in(), TODAY, NOW)

    assert refusal(error) == (422, "2026-Ramesh-Chain is already forfeited")


def test_forfeiting_records_what_was_recovered(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    changes.forfeit(
        conn,
        chain,
        changes.ForfeitIn(
            forfeited_on=TODAY, recovered_amount=1_20_000 * RUPEE, note=" Sold "
        ),
        TODAY,
        NOW,
    )

    row = replay(conn, chain).row
    assert (row["status"], row["recovered_amount"], row["closure_note"]) == (
        "forfeited",
        1_20_000 * RUPEE,
        "Sold",
    )
    # Nothing but the Forfeiture since the Mortgage was lent
    made = [e.action for e in mortgage_history(conn, chain) if e.action != "created"]
    assert made == ["forfeited"]


def test_reopening_a_redemption_voids_its_final_payment(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    changes.redeem(conn, chain, redeem_in(), TODAY, NOW)
    final = replay(conn, chain).row["redemption_payment_id"]

    changes.reopen(conn, chain, "Paid by mistake", TODAY, NOW)

    mortgage = replay(conn, chain)
    assert (mortgage.row["status"], mortgage.row["redemption_payment_id"]) == (
        "active",
        None,
    )
    assert mortgage.outstanding(TODAY).total == 1_09_000 * RUPEE
    newest = [(e.entity, e.entity_id, e.action) for e in mortgage_history(conn, chain)]
    assert newest[:2] == [("mortgage", chain, "reopened"), ("payment", final, "voided")]


def test_only_a_closed_mortgage_can_be_reopened(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    with pytest.raises(HTTPException) as error:
        changes.reopen(conn, chain, "why", TODAY, NOW)

    assert refusal(error) == (409, "2026-Ramesh-Chain is Active")


def test_a_coming_term_change_is_removed_and_recorded(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    changes.add_term_change(conn, chain, TermChangeIn(monthly_rate_bps=200), TODAY, NOW)
    [coming] = replay(conn, chain).term_changes

    changes.remove_term_change(conn, chain, coming.id, TODAY, NOW)

    assert replay(conn, chain).term_changes == []
    assert mortgage_history(conn, chain)[0].action == "term_change_removed"


def test_a_term_change_on_a_closed_mortgage_stays(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    changes.add_term_change(conn, chain, TermChangeIn(monthly_rate_bps=200), TODAY, NOW)
    [coming] = replay(conn, chain).term_changes
    forfeit(conn, chain, date(2026, 4, 14))

    with pytest.raises(HTTPException) as error:
        changes.remove_term_change(conn, chain, coming.id, TODAY, NOW)

    assert refusal(error) == (409, "2026-Ramesh-Chain is forfeited: reopen it first")


def new_mortgage(customer_id: int, **fields: object) -> MortgageIn:
    values: dict[str, object] = {
        "customer_id": customer_id,
        "start_date": date(2026, 4, 1),
        "amount_lent": LAKH,
        "description": "Gold chain",
        "gross_weight_mg": 20_000,
        "net_weight_mg": 19_000,
        "purity_karat": 22,
    }
    return MortgageIn.model_validate({**values, **fields})


def test_a_new_mortgage_is_named_given_the_default_terms_and_recorded(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)

    created = changes.create_mortgage(conn, new_mortgage(ramesh), TODAY, NOW)

    row = replay(conn, created).row
    assert (row["name"], row["monthly_rate_bps"], row["interest_mode"]) == (
        "2026-Ramesh-GoldChain",
        300,
        "compounded_yearly",
    )
    [entry] = [e for e in mortgage_history(conn, created) if e.field == "amount_lent"]
    assert (entry.action, entry.new_value) == ("created", str(LAKH))


@pytest.mark.parametrize(
    ("changes_made", "code", "why"),
    [
        ({"start_date": date(2026, 4, 21)}, 422, "cannot be in the future"),
        ({"customer_id": 404}, 422, "Customer not found"),
        ({"name": "2026-Ramesh-Chain"}, 409, "already used"),
    ],
)
def test_a_new_mortgage_is_refused_when_it_cannot_stand(
    conn: Connection, changes_made: dict[str, object], code: int, why: str
) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh)  # named 2026-Ramesh-Chain
    asked = new_mortgage(ramesh).model_copy(update=changes_made)

    with pytest.raises(HTTPException) as refused:
        changes.create_mortgage(conn, asked, TODAY, NOW)

    assert refusal(refused)[0] == code and why in refusal(refused)[1]


def test_a_collateral_value_is_set_by_hand_cleared_and_recorded(
    conn: Connection,
) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    changes.set_collateral(conn, chain, 90_000 * RUPEE, TODAY, NOW)
    set_row = replay(conn, chain).row
    changes.set_collateral(conn, chain, None, TODAY, NOW)
    cleared_row = replay(conn, chain).row

    assert (set_row["collateral_override"], set_row["collateral_override_on"]) == (
        90_000 * RUPEE,
        TODAY,
    )
    assert cleared_row["collateral_override"] is None
    assert cleared_row["collateral_override_on"] is None
    edited = [e for e in mortgage_history(conn, chain) if e.action == "edited"]
    assert [(e.old_value, e.new_value) for e in reversed(edited)] == [
        (None, str(90_000 * RUPEE)),
        (str(90_000 * RUPEE), None),
    ]


def test_a_collateral_value_is_refused_when_it_cannot_stand(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    ring = add_mortgage(conn, ramesh, suffix="Ring")
    redeem(conn, ring, TODAY)

    def refused(mortgage_id: int, value: int) -> tuple[int, str]:
        with pytest.raises(HTTPException) as refused:
            changes.set_collateral(conn, mortgage_id, value, TODAY, NOW)
        return refusal(refused)

    assert refused(404, 90_000 * RUPEE)[0] == 404
    assert refused(chain, 0) == (422, "A Collateral Value must be more than ₹0")
    assert refused(ring, 90_000 * RUPEE) == (
        409,
        "2026-Ramesh-Ring is redeemed: reopen it first",
    )


def test_a_photo_is_added_and_removed_and_recorded(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    photo = changes.add_photo(conn, chain, "mortgage-1-a.jpg", NOW)
    removed = changes.remove_photo(conn, chain, photo, NOW)

    assert removed == "mortgage-1-a.jpg"
    made = [e.action for e in mortgage_history(conn, chain) if e.action != "created"]
    assert made == ["photo_removed", "photo_added"]


def test_a_photo_is_refused_for_no_mortgage_or_removed_from_the_wrong_one(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    ring = add_mortgage(conn, ramesh, suffix="Ring")
    photo = changes.add_photo(conn, chain, "mortgage-1-a.jpg", NOW)

    with pytest.raises(HTTPException) as no_mortgage:
        changes.add_photo(conn, 404, "mortgage-404-a.jpg", NOW)
    with pytest.raises(HTTPException) as wrong_one:
        changes.remove_photo(conn, ring, photo, NOW)

    assert refusal(no_mortgage) == (404, "Mortgage not found")
    assert refusal(wrong_one) == (404, "Photo not found")
