#!/usr/bin/env node
// Push the committed rulesets (.github/rulesets/*.json) to GitHub, or show how they differ.
//
//   node .github/scripts/apply-rulesets.mjs              dry-run: print committed vs live, change nothing
//   node .github/scripts/apply-rulesets.mjs --dry-run    the same
//   node .github/scripts/apply-rulesets.mjs --apply      create/update the rulesets (owner approval first)
//   --repo owner/name overrides the repository (default: the current checkout's, via `gh`)
//
// It talks to GitHub through the `gh` CLI, so it runs as whoever is signed in there. Only the owner
// changes repository settings: run --apply only after the owner has approved the dry-run diff.
import { readdirSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { diffRulesets, planApply } from './lib/rulesets.mjs';

const RULESET_DIR = fileURLToPath(new URL('../rulesets/', import.meta.url));
const execFileAsync = promisify(execFile);

export function committedRulesets(dir = RULESET_DIR) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: f, ruleset: JSON.parse(readFileSync(`${dir}${f}`, 'utf8')) }));
}

async function ghApi(method, path, body) {
  const args = ['api', '-X', method, path, '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  if (body) args.push('--input', '-');
  const child = execFileAsync('gh', args, { maxBuffer: 10 * 1024 * 1024 });
  if (body) child.child.stdin.end(JSON.stringify(body));
  const { stdout } = await child;
  return stdout ? JSON.parse(stdout) : {};
}

export async function run({ args, gh = ghApi, log = console.log, repo, rulesets = committedRulesets() }) {
  const unknown = args.filter((a) => !['--dry-run', '--apply'].includes(a));
  if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(' ')}`);
  const apply = args.includes('--apply');
  if (apply && args.includes('--dry-run')) throw new Error('Use --dry-run or --apply, not both.');

  const base = `/repos/${repo}/rulesets`;
  const existing = await gh('GET', base);
  let drift = false;
  for (const { file, ruleset } of rulesets) {
    const plan = planApply(ruleset, existing);
    let differs = true;
    if (plan.action === 'create') {
      log(`${ruleset.name} (${file}): not on GitHub yet; would be created.`);
    } else {
      const differences = diffRulesets(ruleset, await gh('GET', `${base}/${plan.id}`));
      differs = differences.length > 0;
      log(differences.length
        ? `${ruleset.name} (${file}): live differs from committed:\n  ${differences.join('\n  ')}`
        : `${ruleset.name} (${file}): no drift.`);
    }
    drift ||= differs;
    if (apply && differs) {
      if (plan.action === 'create') await gh('POST', base, ruleset);
      else await gh('PUT', `${base}/${plan.id}`, ruleset);
      log(`  applied (${plan.action}).`);
    }
  }
  if (!apply) log(drift ? 'Dry-run: drift found; nothing changed. Re-run with --apply after owner approval.' : 'Dry-run: no drift.');
  return drift && !apply ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--repo');
  const repoArg = i >= 0 ? argv.splice(i, 2)[1] : undefined;
  const repo = repoArg ?? (await ghApi('GET', '/repos/{owner}/{repo}')).full_name;
  run({ args: argv, repo }).then((code) => process.exit(code), (error) => { console.error(error.message); process.exit(2); });
}
