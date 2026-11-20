# Unreleased changelog fragments

Non-release pull requests **never** edit `CHANGELOG.md`. They add a uniquely named
markdown file here. The **Prepare release candidate** workflow is the only writer of
dated sections in `CHANGELOG.md`: it collates every fragment into
`## [x.y.z] - <date>`, deletes the consumed files, and syncs `VERSION`.

## Naming

```
<unique>.<added|changed|fixed|removed|deprecated|security>.md
```

- `<unique>` is a short slug that will not collide with another open PR
  (for example `advances-phone-scroll` or `474-changelog-fragments`).
- The type suffix is a Keep a Changelog section name, lower-case.

Examples: `advances-panel.added.md`, `receipt-wrap.fixed.md`.

## Body

Keep a Changelog bullets only — one or more lines starting with `- `, using the
repo's usual bold lead-in when naming a feature. No headings, no date, no version.

```md
- **Advances on a phone:** the parts table scrolls sideways instead of widening the page.
```

## Do not

- Edit `## Unreleased` (or any other section) in `CHANGELOG.md` on a non-release PR.
- Bump `VERSION` or package versions; the candidate workflow owns those.
- Leave an empty fragment; CI and prepare both refuse an empty body.

Agent how-to: [Documentation/agents/changelog.md](../../Documentation/agents/changelog.md).
