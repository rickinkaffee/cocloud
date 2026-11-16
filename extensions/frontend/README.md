# Maintained frontend sources

The full web app builds these modules from `../../core/apps/web/src`. The
`src/` mirrors here contain the same maintained upload, download, connection,
file-properties and gesture logic; they do not contain deployed minified bundles.

Install dev dependencies with `npm ci`, install or select Playwright Chromium
using `CHROMIUM_PATH`, then run `npm run build`. This compiles the Ionic gesture
adapter and transfer/property helpers, runs 304 gesture assertions, tests
skip/overwrite/keep-both and placement, sends 9,277 synthetic files / 84 MiB over
real HTTP with overwrite, and exercises hangs, local reads, offset recovery,
restart retries, empty files, cancellation and file-property dialogs/downloads.
The final download regression checks a 108,781,617-byte native attachment with
Unicode filename and SHA-256 while page fetch is disabled. No live projects or
accounts are used.

Native React integration tests live in core under
`apps/web/src/components/WorkbenchExtensions.browser.test.tsx`; the connection
center uses live core access snapshots and original Settings → Access actions.
The full core build is `../../scripts/build-core.sh`. Rebuild both core web and
server and deploy the required sidecars; this test adapter is not a standalone
web application or a script to inject into a live installation.

See `../project-import/README.md`, `../proxy/README.md` and
`../wechat/README.md` for private deployment configuration. Camera, gestures and
Android downloads still require hardware acceptance on the installer's device.
