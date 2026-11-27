// Compare the committed rulesets (.github/rulesets/*.json) with what GitHub holds.
// Only what the committed file declares is compared: GitHub adds server fields (id, dates, links) and
// defaults (integration_id, required_reviewers, ...) that the file does not set, and those are not drift.

// Order never matters in a ruleset: rules by type, checks by context, bypass actors by id, branch patterns.
const SORT_KEY = {
  rules: (r) => r.type,
  required_status_checks: (c) => c.context,
  bypass_actors: (a) => `${a.actor_type}:${a.actor_id}`,
};

function project(committed, live, key) {
  if (Array.isArray(committed)) {
    if (!Array.isArray(live)) return live;
    const sortKey = SORT_KEY[key] ?? ((v) => JSON.stringify(v));
    const byKey = new Map(live.map((item) => [sortKey(item), item]));
    // Keep every live item so an extra live rule/check shows as drift, matched by key where we can.
    return live.map((item) => {
      const mine = committed.find((c) => sortKey(c) === sortKey(item));
      return mine === undefined ? item : project(mine, byKey.get(sortKey(item)), undefined);
    });
  }
  if (committed && typeof committed === 'object') {
    if (!live || typeof live !== 'object') return live;
    return Object.fromEntries(Object.keys(committed).map((k) => [k, project(committed[k], live[k], k)]));
  }
  return live;
}

function sorted(value, key) {
  if (Array.isArray(value)) {
    const sortKey = SORT_KEY[key] ?? ((v) => JSON.stringify(v));
    return value.map((v) => sorted(v)).sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted(value[k], k)]));
  return value;
}

const show = (value) => (value === undefined ? 'missing' : JSON.stringify(value));

function walk(committed, live, path, out) {
  if (committed === undefined || live === undefined) {
    out.push(`${path}\n    committed: ${show(committed)}\n    live: ${show(live)}`);
    return;
  }
  if (Array.isArray(committed) && Array.isArray(live)) {
    const keyOf = SORT_KEY[path.split('.').pop()?.replace(/\[.*$/, '')];
    if (keyOf) {
      const c = new Map(committed.map((v) => [keyOf(v), v]));
      const l = new Map(live.map((v) => [keyOf(v), v]));
      for (const k of [...new Set([...c.keys(), ...l.keys()])].sort()) walk(c.get(k), l.get(k), `${path}[${k}]`, out);
      return;
    }
  }
  if (committed && live && typeof committed === 'object' && typeof live === 'object' && !Array.isArray(committed)) {
    for (const k of Object.keys(committed)) walk(committed[k], live[k], `${path}.${k}`, out);
    return;
  }
  if (JSON.stringify(committed) !== JSON.stringify(live)) out.push(`${path}\n    committed ${show(committed)}\n    live ${show(live)}`);
}

// Returns a list of human-readable differences; empty means no drift.
export function diffRulesets(committed, live) {
  const out = [];
  const c = sorted(committed);
  const l = sorted(project(committed, live));
  // Rules and checks are keyed lists; a live item the file lacks is projected through unchanged so it is reported.
  for (const k of Object.keys(c)) walk(c[k], l[k], k, out);
  return out;
}

// Which API call applies a committed ruleset: match by name among the repository's rulesets.
export function planApply(committed, existing) {
  const match = existing.find((r) => r.name === committed.name);
  return match ? { action: 'update', id: match.id } : { action: 'create' };
}
