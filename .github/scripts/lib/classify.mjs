// The one place that answers path questions. A new top-level folder is one edit here.
//
//   classify(path) -> { product, critical, jobs, languages, runsAll }
//     product    false for internal chore paths (no changelog fragment needed), true otherwise
//     critical   keys of the critical areas the path is in (AREAS below)
//     jobs       heavy CI job groups the path starts: backend, frontend, windows, image
//     languages  CodeQL languages the path is scanned for
//     runsAll    true for a workflow file: a change to it runs every job group and language
//
// Callers: the changed-paths job (changed-paths.mjs), the changelog check (check-changelog.mjs),
// the Dependabot auto-merge rule (lib/auto-merge-allowlist.mjs) and the integration summary
// (integration-summary.mjs). CONTRIBUTING.md "Selective CodeRabbit review" lists the critical
// areas for humans; test-critical-paths.mjs fails when the doc and AREAS disagree.

const B = 'backend/src/mortgage_backend/';

// A path ending in "/" is a folder (prefix match); any other is one file (exact match).
const matches = (file, path) => (path.endsWith('/') ? file.startsWith(path) : file === path);
const inAny = (file, paths) => paths.some((path) => matches(file, path));

export const AREAS = [
  { key: 'money', title: 'Money math', paths: [`${B}lending/`, `${B}payments/`, `${B}platform/money.py`, 'frontend/src/money.ts', 'frontend/src/allocate.ts', 'frontend/src/calculator.ts'] },
  { key: 'auth', title: 'Sign-in / access guard', paths: [`${B}platform/local_only.py`] },
  { key: 'migrations', title: 'Migrations and database', paths: [`${B}migrations/`, `${B}platform/db.py`, `${B}safekeeping/backups.py`] },
  { key: 'security', title: 'Security', paths: [`${B}platform/local_only.py`, `${B}platform/upload_limit.py`, `${B}platform/photos.py`, '.github/workflows/', '.github/rulesets/', 'Dockerfile', 'windows/'] },
];

// Chore paths that need no changelog fragment and are not product.
const CHORE_FOLDERS = ['Documentation/', '.claude/', '.agents/', '.github/', 'changelog/'];
const CHORE_FILES = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'LICENSE', '.editorconfig', '.gitignore', '.coderabbit.yaml'];

const WORKFLOWS = ['.github/workflows/'];
const BACKEND = ['backend/'];
const FRONTEND = ['frontend/'];
const QA = ['qa/']; // check-screen-coverage reads the QA scenarios and the screens still to cover.
// The scripts the heavy jobs themselves run.
const BACKEND_SCRIPTS = ['.github/scripts/check-version.mjs', '.github/scripts/coverage-summary.mjs'];
const FRONTEND_SCRIPTS = [...BACKEND_SCRIPTS, '.github/scripts/check-screen-coverage.mjs', '.github/scripts/test-check-screen-coverage.mjs'];
// Files outside backend/ that backend tests read: the documentation layout test reads
// Documentation/, docs/ and GLOSSARY.md; the OpenAPI test reads frontend/openapi.json. A test that
// reads a new outside path adds it here (and to the CONTRIBUTING.md table).
const BACKEND_READS = ['Documentation/', 'docs/', 'GLOSSARY.md', 'frontend/openapi.json'];
const IMAGE = ['Dockerfile', '.dockerignore'];

// Prefix match for the job lists, as the lists have always been: "Dockerfile" also covers "Dockerfile.x".
const startsWithAny = (file, prefixes) => prefixes.some((prefix) => file.startsWith(prefix));

export const ALL_JOBS = ['backend', 'frontend', 'windows', 'image'];
export const ALL_LANGUAGES = ['actions', 'javascript-typescript', 'python'];

export function classify(path) {
  const backend = startsWithAny(path, BACKEND);
  const frontend = startsWithAny(path, FRONTEND);
  const version = path === 'VERSION';
  const workflow = startsWithAny(path, WORKFLOWS);
  const jobs = {
    backend: backend || version || startsWithAny(path, [...BACKEND_SCRIPTS, ...BACKEND_READS]),
    frontend: frontend || version || startsWithAny(path, [...QA, ...FRONTEND_SCRIPTS]),
    windows: backend || frontend || version || startsWithAny(path, ['windows/']),
    image: backend || frontend || version || startsWithAny(path, IMAGE),
  };
  const languages = {
    actions: workflow,
    'javascript-typescript': startsWithAny(path, [...FRONTEND, ...QA, '.github/scripts/']),
    python: backend,
  };
  return {
    product: !(CHORE_FILES.includes(path) || CHORE_FOLDERS.some((folder) => path === folder.slice(0, -1) || path.startsWith(folder))),
    critical: AREAS.filter(({ paths }) => inAny(path, paths)).map(({ key }) => key),
    jobs: ALL_JOBS.filter((job) => workflow || jobs[job]),
    languages: ALL_LANGUAGES.filter((language) => languages[language]),
    runsAll: workflow,
  };
}
