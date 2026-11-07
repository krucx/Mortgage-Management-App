# Secret scanning alerts are tracked as issues

GitHub Secret scanning remains the source of truth for whether a credential exposure is open or resolved. A daily and manually triggered GitHub Actions workflow reads its alerts with a repository-scoped fine-grained token and keeps one labeled GitHub issue per open alert. The alert number in an HTML comment identifies the corresponding issue, so reconciliation updates or closes the same issue on later runs and reopens it if GitHub reopens the alert.

The issue contains the alert link, type, timestamps, resolution state, affected path and line, and general credential recovery guidance. The workflow maps only those fields from GitHub's alert response; it never copies the `secret` field. A per-alert issue write failure is logged and does not prevent other alerts from being reconciled.

The token is stored in the repository Actions secret `SECRET_SCANNING_TOKEN`. Its fine-grained permissions are **Secret scanning alerts: read** and **Issues: write**, restricted to this repository. The workflow's built-in token has only Contents: read for checkout.

## Considered Options

- **Use the built-in `GITHUB_TOKEN`**: rejected because the required narrow Secret scanning alert permission is not available as a repository Actions permission for this workflow.
- **Put alert details in workflow logs or copy the complete API response into issues**: rejected because the alert response can contain the exposed credential.
- **Create a new issue on every scheduled run**: rejected because one issue per alert gives each exposure a stable, actionable tracker and allows resolved alerts to leave the active issue list.
