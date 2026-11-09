import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileFindings } from './lib/reconciler.mjs';

function fakeIssueStore(existing = []) {
  const issues = existing.map((issue) => ({ ...issue }));
  return {
    issues,
    listCalls: 0,
    async list() { this.listCalls += 1; return issues; },
    async create(issue) {
      const created = { ...issue, number: issues.length + 1 };
      issues.push(created);
      return created;
    },
    async update(number, changes) {
      const issue = issues.find((candidate) => candidate.number === number);
      Object.assign(issue, changes);
      return issue;
    },
  };
}

const marker = (issue) => issue.body?.match(/<!-- marker: (.*?) -->/)?.[1];

const finding = (markerValue, overrides = {}) => ({
  marker: markerValue,
  issue: {
    title: `Finding ${markerValue}`,
    body: `<!-- marker: ${markerValue} -->\nbody`,
    labels: ['finding'],
    state: 'open',
    ...overrides,
  },
});

test('opens a new issue when no existing issue matches the marker', async () => {
  const issueStore = fakeIssueStore();
  await reconcileFindings(issueStore, { findings: [finding('a')], markerFromIssue: marker });

  assert.equal(issueStore.issues.length, 1);
  assert.equal(issueStore.issues[0].title, 'Finding a');
});

test('updates the matching existing issue instead of creating a duplicate', async () => {
  const issueStore = fakeIssueStore([
    { number: 1, title: 'Stale title', body: '<!-- marker: a -->\nold body', labels: ['finding'], state: 'open' },
  ]);
  await reconcileFindings(issueStore, {
    findings: [finding('a', { title: 'Fresh title', body: '<!-- marker: a -->\nnew body' })],
    markerFromIssue: marker,
  });

  assert.equal(issueStore.issues.length, 1);
  assert.equal(issueStore.issues[0].title, 'Fresh title');
  assert.equal(issueStore.issues[0].body, '<!-- marker: a -->\nnew body');
});

test('reopens a closed issue when the finding recurs as open', async () => {
  const issueStore = fakeIssueStore([
    { number: 1, title: 'Finding a', body: '<!-- marker: a -->\nbody', labels: ['finding'], state: 'closed' },
  ]);
  await reconcileFindings(issueStore, { findings: [finding('a')], markerFromIssue: marker });

  assert.equal(issueStore.issues[0].state, 'open');
});

test('skips a closed finding that has no existing issue instead of creating one', async () => {
  const issueStore = fakeIssueStore();
  await reconcileFindings(issueStore, {
    findings: [finding('a', { state: 'closed' })],
    markerFromIssue: marker,
  });

  assert.equal(issueStore.issues.length, 0);
});

test('closes in-scope issues absent from this run, leaving out-of-scope issues untouched', async () => {
  const issueStore = fakeIssueStore([
    { number: 1, title: 'A', body: '<!-- marker: codeql:a -->\nbody', labels: ['finding'], state: 'open' },
    { number: 2, title: 'B', body: '<!-- marker: trivy:b -->\nbody', labels: ['finding'], state: 'open' },
  ]);
  await reconcileFindings(issueStore, {
    findings: [],
    markerFromIssue: marker,
    closeUnseen: true,
    matchesScope: (markerValue) => markerValue.startsWith('codeql:'),
  });

  assert.equal(issueStore.issues[0].state, 'closed');
  assert.equal(issueStore.issues[1].state, 'open');
});

test('leaves issues open by default when closeUnseen is not set', async () => {
  const issueStore = fakeIssueStore([
    { number: 1, title: 'A', body: '<!-- marker: a -->\nbody', labels: ['finding'], state: 'open' },
  ]);
  await reconcileFindings(issueStore, { findings: [], markerFromIssue: marker });

  assert.equal(issueStore.issues[0].state, 'open');
});

test('keeps reconciling the remaining findings when one create fails', async () => {
  const issueStore = fakeIssueStore();
  const originalCreate = issueStore.create.bind(issueStore);
  issueStore.create = async (issue) => {
    if (issue.title === 'Finding a') throw new Error('write failed');
    return originalCreate(issue);
  };
  const logged = [];

  await assert.doesNotReject(reconcileFindings(issueStore, {
    findings: [finding('a'), finding('b')],
    markerFromIssue: marker,
    log: (message) => logged.push(message),
  }));

  assert.equal(issueStore.issues.length, 1);
  assert.equal(issueStore.issues[0].title, 'Finding b');
  assert.equal(logged.length, 1);
});

test('keeps reconciling the remaining findings and closes when one update fails', async () => {
  const issueStore = fakeIssueStore([
    { number: 1, title: 'A', body: '<!-- marker: a -->\nbody', labels: ['finding'], state: 'open' },
    { number: 2, title: 'B', body: '<!-- marker: b -->\nbody', labels: ['finding'], state: 'open' },
  ]);
  const originalUpdate = issueStore.update.bind(issueStore);
  issueStore.update = async (number, changes) => {
    if (number === 1) throw new Error('write failed');
    return originalUpdate(number, changes);
  };

  await assert.doesNotReject(reconcileFindings(issueStore, {
    findings: [],
    markerFromIssue: marker,
    closeUnseen: true,
    log: () => {},
  }));

  assert.equal(issueStore.issues[0].state, 'open');
  assert.equal(issueStore.issues[1].state, 'closed');
});

test('reuses a caller-supplied issue list instead of listing again', async () => {
  const issueStore = fakeIssueStore([
    { number: 1, title: 'A', body: '<!-- marker: a -->\nbody', labels: ['finding'], state: 'open' },
  ]);
  const existingIssues = await issueStore.list();

  await reconcileFindings(issueStore, {
    findings: [finding('a', { title: 'Fresh title' })],
    markerFromIssue: marker,
    existingIssues,
  });

  assert.equal(issueStore.listCalls, 1);
  assert.equal(issueStore.issues[0].title, 'Fresh title');
});
