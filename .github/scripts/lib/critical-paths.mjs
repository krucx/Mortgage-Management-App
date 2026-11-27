// Critical areas, mirrored from CONTRIBUTING.md "Selective CodeRabbit review". Keep the two in step.
// Shared by the integration review summary and the Dependabot auto-merge rule.
const B = 'backend/src/mortgage_backend/';
export const AREAS = [
  { key: 'money', title: 'Money math', paths: [`${B}lending/`, `${B}payments/`, `${B}platform/money.py`, 'frontend/src/money.ts', 'frontend/src/allocate.ts', 'frontend/src/calculator.ts'] },
  { key: 'auth', title: 'Sign-in / access guard', paths: [`${B}platform/local_only.py`] },
  { key: 'migrations', title: 'Migrations and database', paths: [`${B}migrations/`, `${B}platform/db.py`, `${B}safekeeping/backups.py`] },
  { key: 'security', title: 'Security', paths: [`${B}platform/local_only.py`, `${B}platform/upload_limit.py`, `${B}platform/photos.py`, '.github/workflows/', '.github/rulesets/', 'Dockerfile', 'windows/'] },
];

export function matchesPath(file, path) {
  return path.endsWith('/') ? file.startsWith(path) : file === path;
}

export function isCriticalPath(file) {
  return AREAS.some(({ paths }) => paths.some((path) => matchesPath(file, path)));
}
