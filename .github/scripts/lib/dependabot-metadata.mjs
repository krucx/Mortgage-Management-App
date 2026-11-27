// What Dependabot says it changed, read from the PR's commit messages.
//
// Dependabot writes one commit per PR whose body ends with a YAML block (the same block the
// dependabot/fetch-metadata action parses):
//
//   updated-dependencies:
//   - dependency-name: vite
//     dependency-version: 8.3.8
//     dependency-type: direct:development
//     update-type: version-update:semver-patch
//     dependency-group: npm
//
// A grouped PR has one entry per package, so "contains a major" is checked per entry, never from a
// single PR-level value. An entry with no update-type (Dependabot omits it for an indirect/ancestor
// dependency, as in PRs #439 and #472) is reported with updateType null.

export function parseUpdatedDependencies(message) {
  const block = String(message ?? '').split(/^updated-dependencies:\s*$/m)[1]?.split(/^\.\.\.\s*$/m)[0];
  if (block === undefined) return [];
  const dependencies = [];
  for (const line of block.split('\n')) {
    const name = line.match(/^- dependency-name:\s*"?([^"\s]+)"?\s*$/);
    if (name) {
      dependencies.push({ name: name[1], updateType: null });
      continue;
    }
    const type = line.match(/^\s+update-type:\s*(\S+)\s*$/);
    if (type && dependencies.length) dependencies[dependencies.length - 1].updateType = type[1];
  }
  return dependencies;
}

// The human-readable lines give the versions. They are the second signal for a major bump, and the
// only source of an update type when the metadata has none. Dependabot words them two ways:
//   grouped / multi-package:  Updates `vite` from 8.3.7 to 8.3.8
//   single package:           Bumps [opentelemetry-api](https://...) from 1.45.1 to 1.45.2.
export function parseVersionChanges(message) {
  const text = String(message ?? '');
  const updates = [...text.matchAll(/^Updates `([^`]+)` from (\S+) to (\S+)\s*$/gm)];
  const bumps = [...text.matchAll(/^Bumps \[([^\]]+)\]\([^)]*\) from (\S+) to (\S+?)\.?\s*$/gm)];
  return [...updates, ...bumps].map(([, name, from, to]) => ({ name, from, to }));
}

const parts = (version) => version.match(/^v?(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);

// 'major' | 'minor' | 'patch' from two versions, or null when they are not plain x.y.z (or go backwards).
export function classifyVersionChange({ from, to }) {
  const [a, b] = [parts(from), parts(to)];
  if (!a || !b) return null;
  if (b[0] !== a[0]) return b[0] > a[0] ? 'major' : null;
  if (b[1] !== a[1]) return b[1] > a[1] ? 'minor' : null;
  return b[2] > a[2] ? 'patch' : null;
}

const SAFE = new Set(['version-update:semver-patch', 'version-update:semver-minor']);

// Returns { safe: true } or { safe: false, reason }. Fails closed. Each dependency's type is the
// metadata's, or, when Dependabot gave none (indirect dependencies), the one derived from its
// version lines; a major from either source refuses the whole PR, and so does a type neither gives.
export function judgeUpdates(messages) {
  const dependencies = messages.flatMap(parseUpdatedDependencies);
  if (!dependencies.length) return { safe: false, reason: 'dependabot-no-metadata' };
  const versions = messages.flatMap(parseVersionChanges);
  const derived = new Map(versions.map((change) => [change.name, classifyVersionChange(change)]));

  const major = dependencies.find((d) => d.updateType === 'version-update:semver-major')
    ?? versions.find((change) => derived.get(change.name) === 'major');
  if (major) return { safe: false, reason: `dependabot-major (${major.name})` };

  const unknown = dependencies.find((d) => !(d.updateType ? SAFE.has(d.updateType) : ['minor', 'patch'].includes(derived.get(d.name))));
  if (unknown) return { safe: false, reason: `dependabot-unknown-update-type (${unknown.name})` };
  return { safe: true };
}
