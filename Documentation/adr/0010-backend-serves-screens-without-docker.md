# Without Docker, the backend serves the app's built screens itself

Without Docker the app used to run as two processes from the Lender's window: the backend, and `vite preview` serving the screens and passing `/api` on to it. That needed Node.js and `node_modules` (some 220 MB, installed with `npm ci`, the screens built with `npm run build`) on the Lender's laptop. A release now comes with its screens built (the ready-built download), and the backend serves them itself on the app's port when `SCREENS_DIR` is set (windows/run.ps1 sets it), with the same caching as nginx in Docker: pages, the service worker and the manifest checked every time, the hashed files in `/assets` kept. One process, one origin, nothing to pass `/api` on, and no Node.js needed to install or run a release. Docker keeps nginx.

## Considered Options

- **Ship `node_modules` (vite) in the download and keep `vite preview`**: rejected because it is some 220 MB, built per platform, still needs Node.js to run, and `vite preview` isn't meant to serve an app for real.
- **A small Node.js server with no packages (`node:http`)**: rejected because Node.js, and the winget install that most often prompts or fails on the Lender's laptop, would stay, along with a hand-written `/api` proxy (photo uploads up to 20 MB included).
- **A bundled Caddy or nginx for Windows**: rejected because it is a third-party binary to download, keep up to date and get past SmartScreen, with a config that drifts from Docker's.
- **Python's own `http.server`, or PowerShell's `HttpListener`**: rejected because each is another process with a hand-written proxy, and the backend can do the same with less.
- **Serve the screens from the backend in Docker too, dropping the nginx container**: left for later; it is simpler, but changes how the published images work (Documentation/adr/0004).
