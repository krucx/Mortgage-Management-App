- **Releases:** this release also carries everything in the unpublished 3.5.3 and 3.5.4 changelog sections below, because those versions were merged but never tagged or published (their publisher runs failed on the release pull request's `qa` check). 3.5.2 was the last published release.

- **QA, money math:** new backend and frontend edge-case tests cover the money arithmetic (ledger edges, Mortgage page figures), including same-day Payments in reverse id order.

- **Contributing:** `CONTRIBUTING.md` and the agent instructions describe the selective CodeRabbit review: only `integration/*` pull requests and pull requests touching a critical area are reviewed.
