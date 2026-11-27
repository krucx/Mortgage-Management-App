import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKER, classifyFiles, checkStatuses, isIntegrationPr, ticketRefs, uncheckedCriteria,
  buildSummary, upsertSummary,
} from './integration-summary.mjs';

const pr = { number: 90, title: 'Integration: batch 4', html_url: 'https://github.com/o/r/pull/90' };
const worker = (number, title, body = '') => ({ number, title, body, html_url: `https://github.com/o/r/pull/${number}` });
const issueBody = (...lines) => `## What\nx\n\n## Acceptance criteria\n\n${lines.join('\n')}\n\n## Blocked by\n- [ ] not a criterion\n`;

test('only integration/* into main in this repo qualifies', () => {
  const ok = { base: { ref: 'main' }, head: { ref: 'integration/batch-4', repo: { full_name: 'o/r' } } };
  assert.equal(isIntegrationPr(ok, 'o/r'), true);
  assert.equal(isIntegrationPr({ ...ok, base: { ref: 'integration/x' } }, 'o/r'), false);
  assert.equal(isIntegrationPr({ ...ok, head: { ref: 'feature/x', repo: { full_name: 'o/r' } } }, 'o/r'), false);
  assert.equal(isIntegrationPr({ ...ok, head: { ref: 'integration/x', repo: { full_name: 'fork/r' } } }, 'o/r'), false);
  assert.equal(isIntegrationPr({ ...ok, head: { ref: 'xintegration/x', repo: { full_name: 'o/r' } } }, 'o/r'), false);
});

test('ticketRefs reads closing keywords, falling back to the title', () => {
  assert.deepEqual(ticketRefs('Add thing (#12)', 'Closes #12\nFixes krucx/r#13, resolves #12'), [12, 13]);
  assert.deepEqual(ticketRefs('Add thing (#12)', 'no keyword'), [12]);
  assert.deepEqual(ticketRefs('Plain', null), []);
});

test('uncheckedCriteria only reads the Acceptance criteria section', () => {
  const body = issueBody('- [x] done', '- [ ] first open', '* [ ] second open');
  assert.deepEqual(uncheckedCriteria(body), ['first open', 'second open']);
  assert.deepEqual(uncheckedCriteria('no section\n- [ ] stray'), []);
  assert.deepEqual(uncheckedCriteria(null), []);
});

test('classifyFiles groups by critical area, with other for the rest', () => {
  const groups = classifyFiles([
    'backend/src/mortgage_backend/lending/ledger.py',
    'frontend/src/money.ts',
    'backend/src/mortgage_backend/migrations/0001.py',
    'backend/src/mortgage_backend/platform/local_only.py',
    '.github/workflows/new.yml',
    'README.md',
  ]);
  assert.deepEqual(groups.money, ['backend/src/mortgage_backend/lending/ledger.py', 'frontend/src/money.ts']);
  assert.deepEqual(groups.migrations, ['backend/src/mortgage_backend/migrations/0001.py']);
  assert.deepEqual(groups.auth, ['backend/src/mortgage_backend/platform/local_only.py']);
  assert.deepEqual(groups.security, ['backend/src/mortgage_backend/platform/local_only.py', '.github/workflows/new.yml']);
  assert.deepEqual(groups.other, ['README.md']);
});

test('checkStatuses reports each required check, latest run wins, missing when absent', () => {
  const runs = [
    { name: 'backend', status: 'completed', conclusion: 'failure', completed_at: '2026-01-01T00:00:00Z' },
    { name: 'backend', status: 'completed', conclusion: 'success', completed_at: '2026-01-02T00:00:00Z' },
    { name: 'frontend', status: 'in_progress', conclusion: null },
    { name: 'image', status: 'completed', conclusion: 'failure', completed_at: '2026-01-02T00:00:00Z' },
    { name: 'qa', status: 'completed', conclusion: 'skipped', completed_at: '2026-01-02T00:00:00Z' },
  ];
  const result = checkStatuses(['backend', 'frontend', 'image', 'qa', 'windows'], runs);
  assert.deepEqual(result.map((c) => [c.name, c.state]), [
    ['backend', 'passed'], ['frontend', 'pending'], ['image', 'failed'], ['qa', 'passed'], ['windows', 'missing'],
  ]);
});

test('summary with no worker PRs, no critical files, no tickets', () => {
  const text = buildSummary({ pr, workerPrs: [], files: ['README.md'], checks: [], tickets: new Map() });
  assert.ok(text.startsWith(MARKER));
  assert.match(text, /No worker pull requests were merged into this branch/);
  assert.match(text, /No critical area touched/);
  assert.match(text, /### Other \(1\)/);
  assert.match(text, /No linked ticket has unticked acceptance criteria/);
});

test('summary lists each worker PR with its tickets', () => {
  const text = buildSummary({
    pr,
    workerPrs: [worker(81, 'Add A', 'Closes #10'), worker(82, 'Add B', 'no ticket here')],
    files: [], checks: [], tickets: new Map([[10, { title: 'Ticket ten', unchecked: [] }]]),
  });
  assert.match(text, /- #81 Add A — closes #10 \(Ticket ten\)/);
  assert.match(text, /- #82 Add B — no linked ticket/);
});

test('a critical-area touch is stated prominently', () => {
  const text = buildSummary({
    pr, workerPrs: [], files: ['frontend/src/money.ts', 'README.md'], checks: [], tickets: new Map(),
  });
  assert.match(text, /> \[!WARNING\]\n> Touches critical areas: money math/);
  assert.match(text, /### Money math \(1\)\n- `frontend\/src\/money.ts`/);
  assert.doesNotMatch(text, /No critical area touched/);
});

test('unticked acceptance criteria are flagged against their ticket', () => {
  const text = buildSummary({
    pr, workerPrs: [worker(81, 'Add A', 'Closes #10')], files: [], checks: [],
    tickets: new Map([[10, { title: 'Ticket ten', unchecked: ['first open', 'second open'] }]]),
  });
  assert.match(text, /#10 Ticket ten: 2 unticked/);
  assert.match(text, /  - \[ \] first open/);
  assert.doesNotMatch(text, /No linked ticket has unticked/);
});

test('check status table marks failures and pending', () => {
  const text = buildSummary({
    pr, workerPrs: [], files: [], tickets: new Map(),
    checks: [{ name: 'backend', state: 'passed' }, { name: 'image', state: 'failed' }, { name: 'qa', state: 'pending' }],
  });
  assert.match(text, /\| backend \| ✅ passed \|/);
  assert.match(text, /\| image \| ❌ failed \|/);
  assert.match(text, /\| qa \| ⏳ pending \|/);
});

test('long file lists are capped', () => {
  const files = Array.from({ length: 80 }, (_, i) => `docs-${i}.md`);
  const text = buildSummary({ pr, workerPrs: [], files, checks: [], tickets: new Map() });
  assert.match(text, /### Other \(80\)/);
  assert.match(text, /…and 30 more/);
});

function fakeComments(existing) {
  const comments = existing.map((c) => ({ ...c }));
  return {
    comments,
    async list() { return comments; },
    async create(body) { comments.push({ id: comments.length + 100, body }); },
    async update(id, body) { comments.find((c) => c.id === id).body = body; },
  };
}

test('upsertSummary creates once then updates in place', async () => {
  const store = fakeComments([{ id: 1, body: 'human comment' }]);
  await upsertSummary(store, `${MARKER}\nfirst`);
  await upsertSummary(store, `${MARKER}\nsecond`);
  await upsertSummary(store, `${MARKER}\nthird`);
  assert.equal(store.comments.length, 2);
  assert.equal(store.comments[1].body, `${MARKER}\nthird`);
  assert.equal(store.comments[0].body, 'human comment');
});
