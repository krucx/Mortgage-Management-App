# One image: the backend serves the screens in Docker too

In Docker the app ran as two services and two images: nginx serving the built screens and passing `/api` on to the backend, and the backend itself (Documentation/adr/0004). Without Docker the backend already served the screens itself, with the same caching (Documentation/adr/0010), so the two modes served the app two different ways, with two caching configs kept in step by a test. The app now ships as **one image** and **one Compose service, `app`**, the backend serving the screens in Docker too: the root `Dockerfile` builds the screens in a Node stage and copies them into the Python image, which sets `SCREENS_DIR`. One process and one origin in both modes, one image to publish, pull and remove, and nothing to proxy.

The Node stage runs on the build machine's own platform (`$BUILDPLATFORM`): the built screens are the same files on every platform, so `npm ci` never runs under emulation for arm64. The port stays `127.0.0.1:${APP_PORT:-8080}`, now published from the backend's 8000. The upload cap nginx enforced (20 MB on any request body) moved into the backend, so it holds in both modes. A version from before this still runs its two services: Setup, Run and the README start a version with `docker compose up -d --remove-orphans`, so switching between the two removes the other's containers, which would otherwise hold the port.

## Considered Options

- **Keep nginx in Docker**: rejected because it is a second image and a second caching config for the same app, and the backend already serves the screens without Docker.
- **Build the screens on every platform, in each platform's image**: rejected because the files are identical, and `npm ci` under arm64 emulation is slow and brittle.
