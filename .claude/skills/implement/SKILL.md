---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Add a changelog fragment under `changelog/unreleased/` for any product or user-facing change (CI fails without one).

Once done, call the Skill tool with "code-review" to review the work.

Commit your work to the current branch, then open a pull request following [CONTRIBUTING.md](../../../CONTRIBUTING.md), based on the ticket's `integration/*` branch if the ticket belongs to one, otherwise on `main`, and filled in from [the pull request template](../../../.github/pull_request_template.md): describe the user-visible change, verification performed, and any risk or migration impact; link the originating ticket if one was referenced; use a draft pull request if work is unfinished. The automated reviewer (currently CodeRabbit) is selective ([CONTRIBUTING.md](../../../CONTRIBUTING.md#selective-coderabbit-review)): put `@coderabbitai ignore` in the description and request no review (CodeRabbit's opt-out), unless the diff touches money math, sign-in, migrations or security, in which case add the `critical` label. Never approve a pull request. Never merge, or enable auto-merge on, a pull request into `main`: the owner merges those. Do not enable auto-merge on an `integration/*` pull request either; the central auto-merge workflow does.
