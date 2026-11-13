# Coding standards

Rules that need judgement, for reviewers (CodeRabbit and humans). Rules a tool can check
are listed under [Checked mechanically](#checked-mechanically) and are not restated.

## Judgement rules

- **User-visible copy uses [GLOSSARY](Documentation/GLOSSARY.md) terms, written for the
  Lender.** The Lender is one person running their own book, not a developer; a synonym the
  glossary says to avoid makes the same thing look like two things.
- **The module that owns a concept decides its rules; callers don't.** A rule copied into a
  caller drifts from the owner's (architecture review pass 7: Discounts, Reminders and Terms
  correction). Ask the owner, or move the rule into it.
- **A new domain decision gets an ADR** in [Documentation/adr](Documentation/adr), and a new
  domain term goes in the glossary. Otherwise a later review re-suggests what was settled.

## Checked mechanically

If a check below fails or is missing, fix the check; don't add a review comment for it.

- Customer messages (Receipts, Reminders) never show internal Mortgage Names or ids: the
  customer-message test, PR [#367](https://github.com/krucx/Mortgage-Management-App/pull/367).
- `VERSION` changes only through the release candidate: the VERSION check,
  PR [#371](https://github.com/krucx/Mortgage-Management-App/pull/371).
- Formatting: Prettier on the frontend, ruff on the backend (CI; see
  [CONTRIBUTING.md](CONTRIBUTING.md)).
- No direct `fetch` in the frontend: the `no-restricted-globals` rule in
  [frontend/.oxlintrc.json](frontend/.oxlintrc.json).
