import { cpus } from 'node:os';
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

// The coverage list: each scenario in features/*.feature is a Playwright test (bddgen writes
// them to .features-gen). Scenarios tagged @fresh run against an app with no data, those
// tagged @golden only read the golden book, and the rest, which change data, seed their own
// on the work app. `scripts/qa-stack.sh test` runs the three apps at once, and `--mode`
// (QA_SPECS) keeps one of the projects.
const testDir = defineBddConfig({ features: 'features/*.feature', steps: 'steps/*.ts' });
const FRESH = /@fresh/;
const GOLDEN = /@golden/;
const specs = process.env.QA_SPECS;

const projects = [
  { name: 'fresh', grep: FRESH, use: { baseURL: process.env.FRESH_URL ?? 'http://qa-fresh:8000' } },
  { name: 'golden', grep: GOLDEN, use: { baseURL: process.env.GOLDEN_URL ?? 'http://qa-golden:8000' } },
  { name: 'work', grepInvert: [FRESH, GOLDEN], use: { baseURL: process.env.WORK_URL ?? 'http://qa-work:8000' } },
];

export default defineConfig({
  testDir,
  fullyParallel: true,
  workers: cpus().length,
  outputDir: 'test-results',
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: projects.filter((project) => !specs || project.name === specs),
});
