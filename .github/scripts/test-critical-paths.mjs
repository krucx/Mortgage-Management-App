import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AREAS } from './lib/critical-paths.mjs';

// CONTRIBUTING.md lists the critical areas for humans; lib/critical-paths.mjs is what CI uses.
const doc = readFileSync(new URL('../../CONTRIBUTING.md', import.meta.url), 'utf8').replaceAll('\n', ' ');
const BACKEND = 'backend/src/mortgage_backend/';

test('every critical path the code uses is listed in CONTRIBUTING.md', () => {
  for (const { title, paths } of AREAS) {
    for (const path of paths) {
      // The doc may name a backend module relative to its "under backend/src/mortgage_backend/" note.
      const names = [path, path.startsWith(BACKEND) ? path.slice(BACKEND.length) : path];
      assert.ok(names.some((n) => doc.includes(`\`${n}\``)), `${title}: ${path} is not in CONTRIBUTING.md`);
    }
  }
});

test('CONTRIBUTING.md points at the module that holds the list', () => {
  assert.match(doc, /\.github\/scripts\/lib\/critical-paths\.mjs/);
  assert.doesNotMatch(doc, /mirrored in `\.github\/scripts\/integration-summary\.mjs`/);
});
