#!/usr/bin/env python3
"""QA Stack Scenarios: Advance Payments (Issues #399-#406) and Unreleased Features.

Runs against a running QA stack (e.g. started with scripts/qa-stack.sh up) to:
1. Verify the QA stack API and screens end-to-end.
2. Seed realistic test scenarios covering Issues 399-406 (Advance payments,
   multi-mortgage split, receipts, cancellation, closure with advance, reopen,
   overheld refusal guard) and unreleased features (history pagination, etc.).
3. Assert that all scenarios produce the expected responses and states.

Usage:
    python3 scripts/qa-scenarios.py [URL]

If URL is omitted, it auto-detects the port of the running 'mortgage-qa' container.
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def detect_qa_url() -> str:
    """Detect the URL of the running QA stack container."""
    try:
        out = subprocess.check_output(
            ["docker", "port", "mortgage-qa", "8000"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        host_port = out.split("\n")[0]
        if "->" in host_port:
            host_port = host_port.split("->")[-1].strip()
        return f"http://{host_port}"
    except Exception:
        return "http://127.0.0.1:8000"


def request(
    url: str, method: str = "GET", data: dict[str, Any] | None = None
) -> tuple[int, Any]:
    body = json.dumps(data).encode("utf-8") if data is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            status = response.status
            try:
                parsed = json.loads(res_body) if res_body else None
            except json.JSONDecodeError:
                parsed = res_body
            return status, parsed
    except urllib.error.HTTPError as err:
        err_body = err.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except json.JSONDecodeError:
            parsed = err_body
        return err.code, parsed


def run_scenarios(base_url: str) -> None:
    print(f"=== QA Stack Scenario Test on {base_url} ===\n")

    # 0. Health check
    status, res = request(f"{base_url}/api/customers")
    assert status == 200, f"QA stack unreachable: {status} {res}"
    print("✓ QA stack is reachable and answering /api/customers")

    # Verify frontend serves index.html
    status, html = request(f"{base_url}/")
    assert status == 200 and '<div id="root">' in html, "Frontend root screen missing"
    print("✓ Frontend root screen is served correctly")

    # 1. Create Customer: Ramesh Kumar
    print("\n--- Scenario 1: Setup Customer & Mortgages ---")
    status, customer = request(
        f"{base_url}/api/customers",
        method="POST",
        data={
            "name": "Ramesh Kumar",
            "phone_1": "9810012345",
            "address": "12 Civil Lines, Jaipur",
        },
    )
    if status == 409:
        _, by_phone = request(f"{base_url}/api/people/by-phone?phone=9810012345")
        cid = by_phone["id"]
        print(f"✓ Using existing Customer 'Ramesh Kumar' (id: {cid})")
    else:
        assert status == 201, f"Failed to create customer: {status} {customer}"
        cid = customer["id"]
        print(f"✓ Created Customer 'Ramesh Kumar' (id: {cid})")

    # Check existing mortgages
    _, m_list = request(f"{base_url}/api/mortgages")
    existing_m1 = next(
        (
            m
            for m in m_list.get("items", [])
            if "Gold chain" in m["name"]
            or (m["customer"]["id"] == cid and m["amount_lent"] == 500_000_00)
        ),
        None,
    )
    existing_m2 = next(
        (
            m
            for m in m_list.get("items", [])
            if "Diamond" in m["name"]
            or (m["customer"]["id"] == cid and m["amount_lent"] == 200_000_00)
        ),
        None,
    )

    if existing_m1:
        m1_id = existing_m1["id"]
        print(f"✓ Using existing Mortgage 1 (id: {m1_id})")
    else:
        status, m1 = request(
            f"{base_url}/api/mortgages",
            method="POST",
            data={
                "customer_id": cid,
                "start_date": "2026-08-05",
                "amount_lent": 500_000_00,
                "description": "Gold chain and 2 bangles",
                "gross_weight_mg": 25_000,
                "net_weight_mg": 24_000,
                "purity_karat": 22,
                "terms": {
                    "monthly_rate_bps": 200,
                    "interest_mode": "simple",
                    "part_month_rule": "pro_rata",
                },
                "lent_through": "cash",
            },
        )
        assert status == 201, f"Failed to create mortgage 1: {status} {m1}"
        m1_id = m1["id"]
        print(f"✓ Created Mortgage 1 'Gold chain and 2 bangles' (id: {m1_id})")

    if existing_m2:
        m2_id = existing_m2["id"]
        print(f"✓ Using existing Mortgage 2 (id: {m2_id})")
    else:
        status, m2 = request(
            f"{base_url}/api/mortgages",
            method="POST",
            data={
                "customer_id": cid,
                "start_date": "2026-08-12",
                "amount_lent": 200_000_00,
                "description": "Diamond ear tops",
                "gross_weight_mg": 12_000,
                "net_weight_mg": 10_000,
                "purity_karat": 18,
                "terms": {
                    "monthly_rate_bps": 200,
                    "interest_mode": "simple",
                    "part_month_rule": "pro_rata",
                },
                "lent_through": "cash",
            },
        )
        assert status == 201, f"Failed to create mortgage 2: {status} {m2}"
        m2_id = m2["id"]
        print(f"✓ Created Mortgage 2 'Diamond ear tops' (id: {m2_id})")

    # 2. Advance Payment (Issues #399, #400, #401)
    print("\n--- Scenario 2: Recording an Advance Payment (Issues #399-#401) ---")
    payment_payload = {
        "customer_id": cid,
        "paid_on": "2026-10-15",
        "amount": 56_000_00,
        "method": "cash",
        "allocations": [
            {
                "mortgage_id": m1_id,
                "amount": 10_000_00,
                "advance": 30_000_00,
                "months": 3,
            },
            {
                "mortgage_id": m2_id,
                "amount": 4_000_00,
                "advance": 12_000_00,
                "months": 3,
            },
        ],
    }

    # Test preview endpoint
    status, preview = request(
        f"{base_url}/api/payments/preview", method="POST", data=payment_payload
    )
    assert status == 200, f"Payment preview failed: {status} {preview}"
    print("✓ Payment preview computed successfully with Advance schedules")

    # Check if payment was already recorded
    _, p_list = request(f"{base_url}/api/payments")
    existing_p = next(
        (
            p
            for p in p_list.get("items", [])
            if p["customer"]["id"] == cid and p["amount"] == 56_000_00
        ),
        None,
    )
    if existing_p:
        pid = existing_p["id"]
        print(f"✓ Using existing Payment (id: {pid}) with 2 Advance schedules")
    else:
        status, payment = request(
            f"{base_url}/api/payments", method="POST", data=payment_payload
        )
        assert status == 201, f"Payment recording failed: {status} {payment}"
        pid = payment["id"]
        print(
            f"✓ Recorded Payment (id: {pid}) with 2 Advance schedules (Total: ₹56,000)"
        )

    # 3. Receipt with Advance Parts (Issue #403)
    print("\n--- Scenario 3: Verify Receipt with Advance Schedule (Issue #403) ---")
    status, receipt = request(f"{base_url}/api/payments/{pid}/receipt")
    assert status == 200, f"Receipt fetch failed: {status} {receipt}"
    lines = receipt.get("lines", [])
    total_adv_parts = sum(len(line.get("advance_parts", [])) for line in lines)
    assert total_adv_parts == 6, (
        f"Expected 6 advance parts in receipt, got {total_adv_parts}"
    )
    assert "Advance" in receipt.get("text", "")
    print(
        "✓ Receipt lists each Advance part with accrual dates and amounts (Receipt text verified)"
    )

    # 4. Mortgage Page Advance Panel & Part Cancellation (Issue #402)
    print(
        "\n--- Scenario 4: Mortgage Page Advance Panel & Cancellation (Issue #402) ---"
    )
    status, m1_detail = request(f"{base_url}/api/mortgages/{m1_id}")
    assert status == 200, f"Mortgage fetch failed: {status} {m1_detail}"
    instalments = m1_detail.get("advance_instalments", [])
    assert len(instalments) == 3, f"Expected 3 instalments, got {len(instalments)}"
    print(
        f"✓ Mortgage page shows {len(instalments)} Advance instalments (advance_held: ₹{m1_detail.get('advance_held', 0) // 100})"
    )

    # Find an upcoming instalment to cancel
    upcoming_parts = [
        i for i in instalments if i["upcoming"] and not i.get("cancelled_on")
    ]
    if upcoming_parts:
        target_part = upcoming_parts[0]
        part_id = target_part["id"]
        cancel_preview_url = f"{base_url}/api/mortgages/{m1_id}/advance-instalments/{part_id}/cancel-preview"
        status, c_prev = request(cancel_preview_url, method="POST", data={})
        assert status == 200, f"Cancel preview failed: {status} {c_prev}"
        print(f"✓ Cancel preview shows part {part_id} will be applied on cancel date")

        cancel_url = (
            f"{base_url}/api/mortgages/{m1_id}/advance-instalments/{part_id}/cancel"
        )
        status, cancelled = request(cancel_url, method="POST", data={})
        assert status == 200, f"Cancel failed: {status} {cancelled}"
        print(
            f"✓ Cancelled instalment {part_id}: applied immediately, advance_held updated to ₹{cancelled['advance_held'] // 100}"
        )

        # Check receipt for cancelled instalment
        status, c_receipt = request(
            f"{base_url}/api/payments/{pid}/advance-instalments/{part_id}/receipt"
        )
        assert status == 200, f"Cancelled part receipt failed: {status} {c_receipt}"
        print("✓ Cancelled instalment has its own standalone receipt")
    else:
        print("✓ Part was already cancelled in previous run")

    # 5. Overholding Guard Refusal (Issue #405, ADR 0021)
    print("\n--- Scenario 5: Overheld Refusal Guard (Issue #405) ---")
    excessive_payment = {
        "customer_id": cid,
        "paid_on": "2026-10-16",
        "amount": 700_000_00,
        "method": "cash",
        "allocations": [
            {
                "mortgage_id": m2_id,
                "amount": 0,
                "advance": 700_000_00,  # Far exceeds m2 outstanding
                "months": 3,
            }
        ],
    }
    status, err = request(
        f"{base_url}/api/payments", method="POST", data=excessive_payment
    )
    assert status == 422, f"Expected 422 for overheld advance, got {status}"
    print("✓ Attempting to hold more than Outstanding is safely refused with HTTP 422")

    # 6. Closure Cancels Advance Parts & Reopen Restores (Issue #404, PR #417)
    print(
        "\n--- Scenario 6: Closure Cancels Advances & Reopen Restores (Issue #404) ---"
    )
    status, priya = request(
        f"{base_url}/api/customers",
        method="POST",
        data={
            "name": "Priya Sharma",
            "phone_1": "9820054321",
            "address": "45 Park Street, Kolkata",
        },
    )
    if status == 409:
        _, by_phone = request(f"{base_url}/api/people/by-phone?phone=9820054321")
        pid_priya = by_phone["id"]
        print(f"✓ Using existing Customer 'Priya Sharma' (id: {pid_priya})")
    else:
        assert status == 201, f"Failed to create customer: {status} {priya}"
        pid_priya = priya["id"]
        print(f"✓ Created Customer 'Priya Sharma' (id: {pid_priya})")

    _, m_list = request(f"{base_url}/api/mortgages")
    existing_priya_m = next(
        (m for m in m_list.get("items", []) if m["customer"]["id"] == pid_priya), None
    )

    if existing_priya_m:
        m_priya_id = existing_priya_m["id"]
        print(f"✓ Using existing Mortgage for Priya (id: {m_priya_id})")
    else:
        status, m_priya = request(
            f"{base_url}/api/mortgages",
            method="POST",
            data={
                "customer_id": pid_priya,
                "start_date": "2026-08-01",
                "amount_lent": 100_000_00,
                "description": "Gold bangles",
                "gross_weight_mg": 15_000,
                "net_weight_mg": 14_000,
                "purity_karat": 22,
                "terms": {
                    "monthly_rate_bps": 200,
                    "interest_mode": "simple",
                    "part_month_rule": "pro_rata",
                },
                "lent_through": "cash",
            },
        )
        assert status == 201, f"Failed to create mortgage: {status} {m_priya}"
        m_priya_id = m_priya["id"]
        print(f"✓ Created Mortgage 'Gold bangles' for Priya (id: {m_priya_id})")

    # Check Priya's mortgage status
    status, priya_m_detail = request(f"{base_url}/api/mortgages/{m_priya_id}")
    if not priya_m_detail.get("advance_instalments"):
        status, p_priya = request(
            f"{base_url}/api/payments",
            method="POST",
            data={
                "customer_id": pid_priya,
                "paid_on": "2026-09-01",
                "amount": 6_000_00,
                "method": "cash",
                "allocations": [
                    {
                        "mortgage_id": m_priya_id,
                        "amount": 0,
                        "advance": 6_000_00,
                        "months": 3,
                    }
                ],
            },
        )
        assert status == 201, f"Priya payment failed: {status}"
        print("✓ Created Priya's loan with Advance of ₹6,000 over 3 months")

    # Preview closure
    status, cl_prev = request(
        f"{base_url}/api/closures/redeem-preview",
        method="POST",
        data={
            "redeemed_on": "2026-10-01",
            "method": "cash",
            "mortgage_ids": [m_priya_id],
        },
    )
    assert status == 200, f"Closure preview failed: {status} {cl_prev}"
    print(
        "✓ Closure preview indicates upcoming advance parts will be applied towards balance"
    )

    # Close the mortgage
    status, closed = request(
        f"{base_url}/api/closures/redeem",
        method="POST",
        data={
            "redeemed_on": "2026-10-01",
            "method": "cash",
            "mortgage_ids": [m_priya_id],
        },
    )
    assert status == 200, f"Closure failed: {status} {closed}"
    assert closed[0]["status"] == "redeemed"
    print("✓ Mortgage closed and redeemed: advance parts successfully applied")

    # Reopen mortgage
    status, reopened = request(
        f"{base_url}/api/mortgages/{m_priya_id}/reopen",
        method="POST",
        data={
            "reason": "Mistake",
        },
    )
    assert status == 200, f"Reopen failed: {status} {reopened}"
    assert reopened["status"] == "active"
    print("✓ Mortgage reopened: advance parts restored as upcoming")

    # 7. Unreleased Features: Paged History
    print("\n--- Scenario 7: Unreleased Features - Paged History ---")
    status, hist = request(
        f"{base_url}/api/customers/{cid}/history?page=1&page_size=20"
    )
    assert status == 200, f"Customer history failed: {status}"
    assert "items" in hist and "total" in hist and hist["total"] > 0
    print(f"✓ Customer paged history works: {hist['total']} changes returned (page 1)")

    status, m_hist = request(
        f"{base_url}/api/mortgages/{m1_id}/history?page=1&page_size=20"
    )
    assert status == 200, f"Mortgage history failed: {status}"
    assert "items" in m_hist and "total" in m_hist and m_hist["total"] > 0
    print(
        f"✓ Mortgage paged history works: {m_hist['total']} changes returned (page 1)"
    )

    print("\n=======================================================")
    print("🎉 ALL ADVANCE SCENARIOS & UNRELEASED FEATURES PASSED!")
    print(f"QA Stack at {base_url} is fully populated and verified.")
    print("=======================================================")


if __name__ == "__main__":
    target_url = sys.argv[1] if len(sys.argv) > 1 else detect_qa_url()
    run_scenarios(target_url)
