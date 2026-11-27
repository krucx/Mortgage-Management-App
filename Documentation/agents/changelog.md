# Changelog fragments

Non-release pull requests **never** edit `CHANGELOG.md`. They add a fragment under
`changelog/unreleased/`. The Prepare release candidate workflow collates those
files into a dated section and deletes them. `VERSION` stays release-candidate-owned
(ADR 0018).

## When to add a fragment

Add one whenever the PR changes product behaviour, the Lender-facing GitHub Pages
site under `docs/`, or anything else a release note should mention. Pure chore /
internal-only paths (`Documentation/`, `.github/`, `.claude/`, `AGENTS.md`, and
similar) do not need one; CI allowlists those. A product change with no fragment fails
the `version-bump` job (only `dependabot/*` branches are exempt). Editing `CHANGELOG.md` on a
non-release PR always fails.

## File name

```
changelog/unreleased/<unique>.<added|changed|fixed|removed|deprecated|security>.md
```

Pick a `<unique>` slug that will not collide with another open PR
(`474-changelog-fragments`, `advances-phone-scroll`).

## Body

Keep a Changelog bullets only:

```md
- **Advances on a phone:** the parts table scrolls sideways instead of widening the page.
```

No headings, no version, no date. One fragment may contain several related bullets.

## Examples

| Change | Fragment |
| --- | --- |
| New Advances panel | `advances-panel.added.md` |
| Fix receipt wrapping | `receipt-wrap.fixed.md` |
| Rename a setting | `setting-label.changed.md` |

## Do not

- Append under `## Unreleased` in `CHANGELOG.md`.
- Bump `VERSION` or synced package versions on a feature branch.
- Commit an empty fragment file.

Folder rules also live in [changelog/unreleased/README.md](../../changelog/unreleased/README.md).
Release owner steps: [Documentation/RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md).
