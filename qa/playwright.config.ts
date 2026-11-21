import { cpus } from 'node:os';
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

// The coverage list: each scenario in features/*.feature is a Playwright test (bddgen writes
// them to .features-gen). Scenarios tagged @fresh run against an app with no data, the rest
// against the golden book; `scripts/qa-stack.sh test` runs both apps at once, and `--mode`
// (QA_SPECS) keeps one of the two projects.
const testDir = defineBddConfig({ features: 'features/*.feature', steps: 'steps/*.ts' });
const FRESH = /@fresh/;
const specs = process.env.QA_SPECS;

const projects = [
  { name: 'fresh', grep: FRESH, use: { baseURL: process.env.FRESH_URL ?? 'http://qa-fresh:8000' } },
  { name: 'golden', grepInvert: FRESH, use: { baseURL: process.env.GOLDEN_URL ?? 'http://qa-golden:8000' } },
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
