"""Changes to Mortgages and Payments, straight against the database: each is refused,
written, replayed and recorded in History in one place (today is 20 Apr 2026).

The Mortgage throughout: ₹1,00,000 at 3% a month, Simple, Full-month rule, from
14 Jan 2026, so ₹3,000 of interest on each Accrual Date and ₹1,09,000 owed today.
"""

from datetime import date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy.engine import Connection

from conftest import TODAY
from mortgage_backend import changes
from mortgage_backend.audit import mortgage_history
from mortgage_backend.changes import AllocationIn, PaymentIn, TermChangeIn
from mortgage_backend.mortgages import MortgageEdit
from mortgage_backend.replay import replay
from seed import LAKH, RUPEE, add_customer, add_mortgage, add_payment, close

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
    close(conn, chain, status="forfeited", closed_on=date(2026, 4, 14))

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
    # Paid off exactly on 14 Mar: ₹1,00,000 + ₹6,000.
    add_payment(conn, ramesh, date(2026, 3, 14), {chain: 1_06_000 * RUPEE})

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
        "2026-Ramesh-Chain: the Payment on 14 Mar 2026 would be more than the "
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
    final = add_payment(conn, ramesh, date(2026, 3, 14), {chain: 1_06_000 * RUPEE})
    close(
        conn,
        chain,
        status="redeemed",
        closed_on=date(2026, 3, 14),
        redemption_payment_id=final,
    )

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
    close(conn, chain, status="forfeited", closed_on=date(2026, 4, 14))

    with pytest.raises(HTTPException) as error:
        changes.void_payment(conn, paid, "mistake", TODAY, NOW)

    assert refusal(error) == (409, "2026-Ramesh-Chain is forfeited: reopen it first")


def test_a_term_change_on_a_closed_mortgage_is_refused(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    close(conn, chain, status="forfeited", closed_on=date(2026, 4, 14))

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
    add_payment(conn, ramesh, date(2026, 3, 14), {chain: 1_06_000 * RUPEE})

    with pytest.raises(HTTPException) as error:
        changes.edit_mortgage(conn, chain, edit(amount_lent=50_000 * RUPEE), TODAY, NOW)

    # Lent ₹50,000: only ₹53,000 owed on 14 Mar.
    assert refusal(error) == (
        422,
        "2026-Ramesh-Chain: the Payment on 14 Mar 2026 would be more than the "
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
    close(conn, chain, status="forfeited", closed_on=date(2026, 4, 14))

    with pytest.raises(HTTPException) as error:
        changes.edit_mortgage(conn, chain, edit(amount_lent=90_000 * RUPEE), TODAY, NOW)
    changes.edit_mortgage(conn, chain, edit(description="Two gold chains"), TODAY, NOW)

    assert error.value.status_code == 409
    assert replay(conn, chain).row["description"] == "Two gold chains"


def test_a_refused_change_records_no_history(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    add_payment(conn, ramesh, date(2026, 3, 14), {chain: 1_06_000 * RUPEE})

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
    close(conn, chain, status="forfeited", closed_on=date(2026, 4, 14))

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
    assert [e.action for e in mortgage_history(conn, chain)] == ["forfeited"]


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
    close(conn, chain, status="forfeited", closed_on=date(2026, 4, 14))

    with pytest.raises(HTTPException) as error:
        changes.remove_term_change(conn, chain, coming.id, TODAY, NOW)

    assert refusal(error) == (409, "2026-Ramesh-Chain is forfeited: reopen it first")
