# The sample book behind the GitHub Pages screenshots

Every screenshot on GitHub Pages (`docs/shots`) is taken from the app itself, running on an
invented lending book: the one *The Gold Chain Story* (`docs/story.html`) tells, as it stood
on 19 Oct 2026. Nothing in it is real.

To retake them all, after a change to any screen:

```sh
docs/sample-book/run.sh
```

It needs uv, Node.js and Google Chrome (or Playwright's own Chromium: set `CHROMIUM=1`
after `npx playwright install chromium` in this folder). It works in a scratch folder and
never touches a real database. Then look over the screenshots and the pages, and commit
`docs/shots`, `docs/story.html` and `docs/walkthrough.html`. Running it twice gives the same pages.

- **`book.py`** makes the book through the app's own API, one dated change after another,
  with the app's clock moved to each change's date, so it is refused if the app would have
  refused it then. Change the story's people or figures here (figures.py and call_sheet.py look a few
  Mortgages up by Mortgage Name, so a rename goes there too).
- **`serve.py`** serves the book with the clock kept on 19 Oct 2026, and the app's built
  screens (`frontend/dist`), as the backend does without Docker.
- **`figures.py`** fills in every figure and address the walkthrough and story quote from the
  served book (each marked `data-fig="…"`), so none is typed by hand; it fails if a page
  marks one it can't fill, or a figure goes unused. Add a figure there, then mark it on the page.
- **`simulation.json`** is the Calculator's sample Simulation, as its URL keeps it: the
  inputs `shots.mjs` opens the Calculator with, and that `figures.py` works out for the
  figures the walkthrough and story quote from it. Change the scene there.
- **`call_sheet.py`** fills in the day's exported Call Sheet, for its import scene.
- **`shots.mjs`** opens each scene in a browser (its clock on the same day), photographs
  it, and records where each numbered marker of `story.html` sits on it. Scenes that change
  the book (approving a Reminder, Payments) come last.
- **`publish.py`** writes the screenshots to `docs/shots` as WebP, sets each `<img>`'s
  width and height on the pages, and updates `story.html`'s `SPOTS`.
