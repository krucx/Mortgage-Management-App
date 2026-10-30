# The installed PWA starts and updates the app through a `mortgage-management://` link

The Lender opens the app from its installed PWA icon, but a browser app cannot start the backend, and when nothing is running the icon shows only the cached screens. Setup therefore registers a `mortgage-management://` link for the Windows user: when the PWA cannot reach the backend, its offline screen offers a Start button that opens `mortgage-management://start`, which runs the same launcher as the Desktop shortcut. The in-app update banner's Install now opens `mortgage-management://update` the same way, so the Lender is asked inside the app rather than in a console window they rarely see. The link takes only those two actions and no arguments, so a web page that opens it can at most start or update this app, and Windows asks the Lender first.

## Considered Options

- **Start the app at Windows sign-in**, so the icon always just works: rejected because the app would always be running in the background, and the update prompt still needs a way to run Setup from the app.
- **Keep only the Desktop shortcut**: rejected because the Lender already uses the PWA icon, which then shows a page that cannot work.
