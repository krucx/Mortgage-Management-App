---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, call the Skill tool with "code-review" to review the work.

Commit your work to the current branch, then open a pull request targeting `main` following [CONTRIBUTING.md](../../../CONTRIBUTING.md): describe the user-visible change, verification performed, and any risk or migration impact; link the originating ticket if one was referenced; use a draft pull request if work is unfinished. Leave the merge decision to a human reviewer — do not approve or merge your own pull request.
