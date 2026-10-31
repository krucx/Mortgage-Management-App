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
never touches a real database. Then look over the screenshots and the figures the story
quotes, and commit `docs/shots` and `docs/story.html`.

- **`book.py`** makes the book through the app's own API, one dated change after another,
  with the app's clock moved to each change's date, so it is refused if the app would have
  refused it then. Change the story's people or figures here.
- **`serve.py`** serves the book with the clock kept on 19 Oct 2026, and the app's built
  screens (`frontend/dist`), as the backend does without Docker.
- **`shots.mjs`** opens each scene in a browser (its clock on the same day), photographs
  it, and records where each numbered marker of `story.html` sits on it. Scenes that change
  the book (approving a Notice, Payments) come last.
- **`publish.py`** writes the screenshots to `docs/shots` as WebP, sets each `<img>`'s
  width and height on the pages, and updates `story.html`'s `SPOTS`.
