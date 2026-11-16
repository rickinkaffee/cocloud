# Attachment downloads

File links request a scoped attachment URL only after checking the environment's
filesystem read grant. Same-origin HTTP(S) `/api/assets/` attachments are handed
directly to the browser's download manager. The server supplies attachment headers
and the filename. This avoids reading the entire archive into a page Blob before
starting the download: a successful HTTP 200 can still fail during body reading
with `TypeError: Failed to fetch`.

Image copying, ordinary media URLs, other origins, inline data, and Android's
existing transport keep their previous behavior. A dispatched download means the
browser accepted the handoff; it does not assert that bytes have finished saving.

The maintained implementation is in both `extensions/frontend/src/file-download.ts`
and the web client's `src/extensions/file-download.ts`. `MediaActions.tsx` uses the
helper for `media-file` resources with `disposition: attachment`, so a normal web
build includes the fix without patching generated bundles.

Validation:

- Web unit tests cover an HTTP 200 whose body rejects with `Failed to fetch`, the
  authenticated hook integration, and preserved fallback transports.
- `npm run test:downloads` in `extensions/frontend` compiles the maintained source
  and verifies a native HTTP download of 108,781,617 bytes, Unicode filenames and
  SHA-256 equality even when page `fetch` is disabled. Install the package's dev
  dependencies and Playwright Chromium first; optionally set `CHROMIUM_PATH`.
- The extension's normal build runs the download regression as well.

Physical Android device acceptance is separate from these browser regressions.
