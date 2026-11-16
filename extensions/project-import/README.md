# Folder upload, synchronization and file actions

Use Node 24+ with filesystem access to your own project root. Set
`WORKBENCH_PROJECTS`, `WORKBENCH_ORIGIN` (canonical HTTPS origin), and optionally
`WORKBENCH_INTERNAL_URL` (default `http://127.0.0.1:3773`) and `IMPORT_PORT`
(default 3775). Start `node project-import-server.mjs` and proxy
`/api/cocloud/imports*` to that loopback port. Keep staging and backups private.
Rebuild core web/server with `../../scripts/build-core.sh` for the sidebar upload
UI and the file context-menu actions; deploying this sidecar alone does not
change the page. The sidebar picker lists this server's existing registered
projects; their folders must be within `WORKBENCH_PROJECTS`.

Uploads offer a containing folder or the selected project's root. Same-name
folders merge; same-name files prompt for skip, overwrite or keep-both, optionally
for all remaining conflicts. Skip sends no bytes; keep-both numbers the incoming
file. Cancel during conflict review writes nothing. Upload limits (50,000 files,
20 GiB) apply only to the selected incoming files, never the existing project.
Browser directory picking cannot represent empty local directories; the API
supports an explicit `directories` list for clients that can enumerate them.

Local reads and chunk/status requests are bounded. Three workers transfer chunks
of at most 1 MiB, with up to five attempts and delayed retries after transient
outages. Failures identify the file. Retry the identical folder, target, metadata
and decisions within 24 hours to reuse staged offsets, including empty files.
Transient failure retains staging; explicit cancellation deletes it. Staging
identity is tied to the authenticated owner. Changing options or file metadata
creates a separate upload. This is not automatic background uploading after the
browser closes. After sidecar restart, request a fresh inventory as the UI does;
review tokens are deliberately process-local.

Overwrite checks only selected write targets. Unrelated logs and new project
files do not block it; selected files changed during review/transfer still fail.
Existing destination-only files remain, overwritten files are backed up, and a
checkpoint journal refuses silent partial re-application after a crash.

File-tree/preview context menus expose Download and Properties on the primary
server with filesystem-read scope. Downloads stream through authenticated
attachments; properties include byte count, dates, permissions and directory
contents. Other environments retain their existing actions and do not send paths
to this server's sidecar. Missing, external, symlink and inaccessible paths fail
explicitly. Android uses its installed WebView download handler; test on hardware.

`python3 build.py /path/to/private-release` runs the HTTP regressions before
emitting a source snapshot and hash receipt. `node --test
project-import-server.test.mjs` runs them directly. The portable frontend tests in
`../frontend/` exercise the same transport with 9,277 synthetic files / 84 MiB,
request hangs, local read failures, resume, retries and cancellation. No project,
account, staging file, database, APK or credential is shipped in the repository.
