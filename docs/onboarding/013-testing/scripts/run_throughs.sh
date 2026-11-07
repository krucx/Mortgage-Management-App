#!/bin/sh
# Every count, test name and failure message in chapter 013 comes from this script.
#
# It checks out the current commit into a throwaway git worktree, so nothing in your clone
# changes, then runs the checks CI runs and each lesson's experiment: a change to one line,
# the tests run, the change undone. Sections are headed L1–L5 and 99.
#
# Run from the repo root:  sh docs/onboarding/013-testing/scripts/run_throughs.sh
# Needs uv, Node and (for Pester) Docker. Takes about ten minutes.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git rev-parse --show-toplevel)
WT=$(mktemp -d)/repo
git -C "$REPO" worktree add --detach "$WT" HEAD >/dev/null 2>&1
trap 'git -C "$REPO" worktree remove --force "$WT"' EXIT
ln -s "$REPO/frontend/node_modules" "$WT/frontend/node_modules"
(cd "$WT/backend" && uv sync --frozen -q)

B="$WT/backend"
F="$WT/frontend"
section() { printf '\n==================== %s\n' "$1"; }
undo() { git -C "$WT" checkout -- . && git -C "$WT" clean -fdq -e node_modules -e .venv; }
pytest_summary() { (cd "$B" && uv run pytest -q -p no:cacheprovider "$@" 2>&1 | grep -E '^(FAILED|ERROR)|passed|failed' | sed 's/ - .*//'); }
vitest_summary() { (cd "$F" && npx vitest run "$@" 2>&1 | grep -E '^ (FAIL|×)| Tests | Test Files ' | sed 's/\x1b\[[0-9;]*m//g' | sort -u); }
by_file() { grep -E '^(FAILED|ERROR)' | sed -E 's/^(FAILED|ERROR) tests\/([a-z_]+)\.py.*/\2/' | sort | uniq -c | sort -rn; }

section "L1 every CI check"
(cd "$B" && uv run mypy src | tail -1)
(cd "$B" && uv run pytest -q -p no:cacheprovider | tail -1)
(cd "$F" && npm run -s typecheck && echo "tsc -b: no errors")
(cd "$F" && npx vitest run 2>&1 | grep -E ' Tests | Test Files ')
(cd "$WT" && cmp windows/Setup.bat docs/Setup.bat && echo "Setup.bat: the same")

section "L1 one test: pytest -k cash_limit"
(cd "$B" && uv run pytest -p no:cacheprovider -k cash_limit -v 2>&1 | grep -E 'PASSED|passed')
section "L1 one test: vitest -t 'Term Change'"
(cd "$F" && npx vitest run -t "Term Change" --reporter=verbose 2>&1 | grep -E '✓|Tests ' | sed 's/ [0-9]*ms$//')

section "L1 lint: a fetch planted in src/money.ts"
printf "\nexport const sneaky = () => fetch('/api/customers')\n" >> "$F/src/money.ts"
(cd "$F" && npm run -s typecheck && echo "tsc -b: no errors")
(cd "$F" && npx vitest run 2>&1 | grep -E ' Tests ')
(cd "$F" && npx oxlint 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | head -12)
undo
(cd "$F" && npx oxlint 2>&1 | tail -2)

section "L1 Pester, in a Debian arm64 image"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  docker build -q -t mm-pester -f "$HERE/pester.Dockerfile" "$HERE" >/dev/null
  docker run --rm -v "$WT:/repo:ro" -w /repo mm-pester \
    pwsh -NoProfile -c 'Invoke-Pester windows/tests -Output Normal' 2>&1 | tail -4
else
  echo "(no Docker: skipped)"
fi

section "L2 the reader's test of the Cash Limit"
cat >> "$B/tests/test_cash_limit.py" <<'EOF'


def test_the_cash_limit_can_be_set_back_to_20000_rupees_after_being_cleared(client):
    set_cash_limit(client, None)

    assert set_cash_limit(client, 20_000_00) == {"cash_limit": 20_000_00}
    assert cash_limit(client) == {"cash_limit": 20_000_00}
EOF
(cd "$B" && uv run pytest -p no:cacheprovider tests/test_cash_limit.py -v 2>&1 | grep -E 'PASSED|FAILED|passed|failed')
section "L2 ... with 20_000 (rupees, not paise) expected"
sed -i.bak 's/{"cash_limit": 20_000_00}$/{"cash_limit": 20_000}/' "$B/tests/test_cash_limit.py"
(cd "$B" && uv run pytest -p no:cacheprovider tests/test_cash_limit.py -q 2>&1 | grep -E '^E |passed|failed' | head -8)
undo

section "L2 a refused seed: lend before the Customer exists (customer_id 99)"
cat > "$B/tests/test_try_refused.py" <<'EOF'
from api_seed import lend


def test_a_mortgage_for_nobody(client):
    lend(client, {"id": 99})
EOF
(cd "$B" && uv run pytest -p no:cacheprovider tests/test_try_refused.py -q 2>&1 | grep -E '^E |failed' | head -4)
undo

section "L2 #18: a tests/http.py"
cp "$B/tests/api_seed.py" "$B/tests/http.py"
pytest_summary | tail -3
(cd "$B" && uv run pytest -q -p no:cacheprovider 2>&1 | grep -m3 -E "Error|error" )
undo

section "L3 test_seed"
(cd "$B" && uv run pytest -p no:cacheprovider tests/test_seed.py -v 2>&1 | grep -E 'PASSED|FAILED|passed')
section "L3 TODAY moved forward a day (21 Apr 2026)"
sed -i.bak 's/^TODAY = date(2026, 4, 20)/TODAY = date(2026, 4, 21)/' "$B/tests/conftest.py"
grep -n '^TODAY' "$B/tests/conftest.py"
pytest_summary > "$WT/l3.txt"; tail -1 "$WT/l3.txt"; by_file < "$WT/l3.txt"
grep -E '^FAILED tests/test_call_list' "$WT/l3.txt"
(cd "$B" && uv run pytest -q -p no:cacheprovider tests/test_call_list.py 2>&1 | grep -E '^E ' | head -6)
undo

section "L3 the three layers' speed"
for f in test_ledger test_reminders test_call_list; do (cd "$B" && printf '%s: ' $f && uv run pytest -q -p no:cacheprovider tests/$f.py | tail -1); done

section "L4 the reader's page test"
cat > "$F/tests/TryMortgagePage.test.tsx" <<'EOF'
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MortgagePage } from '../src/pages/MortgagePage'
import { fakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the Mortgage page shows whose jewellery it is and what it owes', async () => {
  const server = fakeServer({ 'GET /api/mortgages/7': mortgage })
  showPage(server, '/mortgages/7', { '/mortgages/:id': <MortgagePage /> })

  expect(await screen.findByRole('link', { name: 'Asha Rao' })).toBeTruthy()
  expect(screen.getAllByText('₹50,750').length).toBeGreaterThan(0)
})

test('what the Mortgage page asks for', async () => {
  const server = fakeServer({ 'GET /api/mortgages/7': mortgage })
  showPage(server, '/mortgages/7', { '/mortgages/:id': <MortgagePage /> })

  await screen.findByRole('link', { name: 'Asha Rao' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(server.requests).toEqual([])
})
EOF
(cd "$F" && npx vitest run tests/TryMortgagePage.test.tsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^[+-] |^[+-]   |✓|×| Tests ' | head -20)
undo

section "L4 fakeServer answers an unrouted request 200 {} instead of 404"
sed -i.bak "22s/return Response.json({ detail: 'Not Found' }, { status: 404 })/return Response.json({})/" "$F/tests/fakeServer.ts"
sed -n '21,23p' "$F/tests/fakeServer.ts"
(cd "$F" && npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ (FAIL) ' | sed -E 's/ > .*//' | sort | uniq -c)
(cd "$F" && npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ FAIL |^TypeError' | sort | uniq -c)
vitest_summary | grep ' Tests '
undo

section "L5 backend: the boundary test deleted, then > broken to >="
python3 - "$B/tests/test_call_list.py" <<'EOF'
import re, sys
p = sys.argv[1]; s = open(p).read()
s = re.sub(r"def test_a_mortgage_at_exactly_the_loan_to_value_limit_is_not_listed.*?\n\n\n", "", s, flags=re.S)
open(p, "w").write(s)
EOF
sed -i.bak '94s/ > settings/ >= settings/' "$B/src/mortgage_backend/follow_up/call_list.py"
sed -n '94p' "$B/src/mortgage_backend/follow_up/call_list.py"
pytest_summary | tail -1
section "L5 backend: the reader's two tests, on the broken line"
cat >> "$B/tests/test_call_list.py" <<'EOF'


def test_a_mortgage_owing_exactly_85_percent_of_its_value_is_not_listed(client, ramesh):
    client.put(
        "/api/settings/gold-rates",
        json=[{"purity_karat": 22, "rate_per_gram": 6_000 * RUPEE}],
    )
    # 10.3 g at ₹6,000 is worth ₹61,800; ₹51,000 lent today owes ₹52,530 with the
    # month's ₹1,530: exactly 85%.
    lend(client, ramesh, "2026-04-20", 51_000 * RUPEE, net_weight_mg=10_300)

    assert listed(client) == []


def test_a_mortgage_owing_a_rupee_over_85_percent_is_listed(client, ramesh):
    client.put(
        "/api/settings/gold-rates",
        json=[{"purity_karat": 22, "rate_per_gram": 6_000 * RUPEE}],
    )
    over = lend(client, ramesh, "2026-04-20", 51_001 * RUPEE, net_weight_mg=10_300)

    assert listed(client) == [(over["name"], ["loan_to_value"])]
EOF
(cd "$B" && uv run pytest -q -p no:cacheprovider tests/test_call_list.py 2>&1 | grep -E '^FAILED|^E  |passed|failed' | sed 's/ - .*//' | head -8)
section "L5 backend: ... and on the real line"
git -C "$WT" checkout -- backend/src/mortgage_backend/follow_up/call_list.py
pytest_summary tests/test_call_list.py
(cd "$B" && uv run pytest -q -p no:cacheprovider tests/test_call_list.py -k "85_percent or rupee_over" -v 2>&1 | grep -E 'PASSED|FAILED')
section "L5 backend: the real test, on the broken line"
undo
sed -i.bak '94s/ > settings/ >= settings/' "$B/src/mortgage_backend/follow_up/call_list.py"
pytest_summary | tail -2
(cd "$B" && uv run pytest -q -p no:cacheprovider tests/test_call_list.py 2>&1 | grep -E '^E  ' | head -3)
undo

section "L5 #113 Dormant: the status check removed"
python3 - "$B/src/mortgage_backend/lending/replay.py" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace('self.row["status"] == MortgageStatus.ACTIVE\n            and self.outstanding', 'self.outstanding')
open(p, "w").write(s)
EOF
sed -n '180,187p' "$B/src/mortgage_backend/lending/replay.py"
pytest_summary | tail -2
undo

section "L5 frontend: the 502 test deleted, then status < 500 broken to true"
python3 - "$F/tests/StartGate.test.tsx" <<'EOF'
import re, sys
p = sys.argv[1]; s = open(p).read()
s = re.sub(r"\ntest\('a 502 from a proxy.*", "", s, flags=re.S)
open(p, "w").write(s)
EOF
sed -i.bak '13s/return response.status < 500/return true/' "$F/src/components/StartGate.tsx"
sed -n '13p' "$F/src/components/StartGate.tsx"
vitest_summary | grep ' Tests '
cat >> "$F/tests/StartGate.test.tsx" <<'EOF'

test('a 503 from in front of the backend is not the backend answering', async () => {
  const { server, start } = backend(() => new Response('Service Unavailable', { status: 503 }))
  const { reloads } = showGate(server, { onWindows: false })

  expect(await screen.findByText(/Start its server/)).toBeTruthy()
  expect(screen.queryByText('The app')).toBeNull()

  start()
  await waitFor(() => expect(reloads()).toBe(1))
})
EOF
section "L5 frontend: the reader's test, on the broken line"
(cd "$F" && npx vitest run tests/StartGate.test.tsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '×|✓| Tests |Unable to find' | head -6)
section "L5 frontend: ... and on the real line"
git -C "$WT" checkout -- frontend/src/components/StartGate.tsx
(cd "$F" && npx vitest run tests/StartGate.test.tsx 2>&1 | grep -E ' Tests ')
undo
section "L5 frontend: the real test, on the broken line"
sed -i.bak '13s/return response.status < 500/return true/' "$F/src/components/StartGate.tsx"
vitest_summary
undo

section "99 add_payment records every Payment on the tests' today (20 Apr 2026)"
sed -i.bak '110s/        paid_on,/        date(2026, 4, 20),/' "$B/tests/seed.py"
sed -n '108,112p' "$B/tests/seed.py"
pytest_summary
(cd "$B" && uv run pytest -q -p no:cacheprovider tests/test_reminders.py 2>&1 | grep -E 'HTTPException|cannot be in the future' | sort -u | head -3)
undo
