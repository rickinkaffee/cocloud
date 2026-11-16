# Open Workbench

Self-hosted coding-agent workbench with a web client, Android WebView client, incremental memory service, shared server browser and project import service.

This source distribution starts from T3 Code v0.1.8 (commit `bf469bb19669671d0df2efda74ed73867a7137c0`) and includes independently maintained extensions. Claude Agent SDK and Cursor SDK integrations are removed from this distribution. Agent executables, commercial model services and provider subscriptions are separate products; no account or subscription is supplied.

No user accounts, credentials, conversations, real project files, personal memory, browser profiles, service addresses, signing keys or prior deployment history are included. Every installation creates its own empty data directories. Tests use synthetic data; the small example workbook is generated data.

## Build the server and web client

Use Linux, Node.js 26 and pnpm 12.14.0. Install dependencies from the committed lockfile:

```sh
cd core
pnpm install --frozen-lockfile
pnpm --dir apps/web exec vp build
pnpm --dir apps/server exec node scripts/cli.ts build
node apps/server/dist/bin.mjs serve --base-dir /var/lib/open-workbench --host 127.0.0.1 --port 3773 --no-browser
```

The first server start creates fresh state and prints its own pairing instructions. Treat those instructions as private. Configure your own installed agent runtime in Settings. Keep the server bound to loopback behind an HTTPS reverse proxy. No original installation is needed.

On a small server, run builds serially in a separate service or container with CPU and memory limits; reserve memory for the running workbench. `scripts/build-core.sh` disables source maps and limits native build concurrency. Its build flags are for distribution on small machines.

The web client includes the maintained Ionic gesture adapter, project-folder visibility policy, memory entry and authenticated file download affordance. The shared browser opens at `/floe/`. Project import exposes its authenticated service API; it is not an anonymous upload endpoint.

## Extensions

Copy this repository to `/opt/open-workbench`, create a dedicated `workbench` Unix account and keep writable state outside the checkout. Install each Node extension with `npm ci` in its own directory. Set `WORKBENCH_ORIGIN` to your canonical HTTPS origin (without a trailing slash) and `WORKBENCH_INTERNAL_URL=http://127.0.0.1:3773`.

### Memory

Create a Python virtual environment and install `extensions/memory/requirements.lock`. Hindsight 1.2.1 is MIT licensed; its database, embedding model, model API and any downloaded runtime components have separate configuration. The lock pins the Python environment used by this integration. See [Hindsight](https://github.com/vectorize-io/hindsight) for engine configuration. No weights or database binaries are redistributed here.

Create a private environment file using `config/memory.env.example`, set a model ID, model base URL and your own API key, then initialize empty state:

```sh
cd /opt/open-workbench/extensions/memory
python3 -m venv /opt/open-workbench-memory/venv
/opt/open-workbench-memory/venv/bin/pip install -r requirements.lock
/opt/open-workbench-memory/venv/bin/python initialize.py
```

Run Hindsight on loopback port 3793, the catalogue API (`api.py`) on 3791, and `gateway.mjs` on 3790/3792. Run `worker.py` for project memory, `profile_memory.py` for optional personal memory and `core.py` for incremental scans. Sample service units are in `extensions/memory/systemd`; adapt executable paths and service environment to your installation.

History ingestion reads only explicitly configured import paths. The defaults point into the new memory data directory's empty `imports/` subdirectories. Set `MEMORY_WORKBENCH_DB`, `MEMORY_CODEX_SESSIONS`, `MEMORY_CODEX_ARCHIVED`, `MEMORY_DSH_SESSIONS`, `MEMORY_ARCHIVE_ROOT` or `MEMORY_DERIVED_ROOT` only when you intend to index those sources. Memory starts empty. Model credentials come from environment variables, never another installed application's account files.

Proxy `/memory/*` and `/api/cocloud/memory/*` to 3790. The gateway validates the workbench session, management scopes and mutation origin. Keep private engine and model-bridge ports inaccessible externally.

### Shared browser

In `extensions/browser`, `npm ci` installs MIT-licensed `@floegence/floebrowser` 0.1.28. Use its documented Playwright browser installation and supported Node runtime. Create private `/var/lib/open-workbench-browser/profile` and `/var/lib/open-workbench-browser/run` directories, owned by a dedicated unprivileged browser service account. Start `source.mjs` and `gateway.mjs`. The source uses loopback 8787/8789; the authenticated gateway uses 3780. Proxy `/floe/*` and `/session/*` to 3780, including WebSocket upgrades. Do not expose source ports or the private endpoint file. Run Chromium with its sandbox enabled; configure the host's user-namespace permissions if necessary.

Each installation creates a new browser profile. Cookies, browsing history and signed-in website sessions are never supplied by this repository.

### Project import

Run `extensions/project-import/project-import-server.mjs` and proxy `/api/cocloud/imports*` to loopback 3775. Set `WORKBENCH_PROJECTS` to an empty workspace root. The service keeps staging files in that root and requires authentication, filesystem scope, an explicit import header and the configured origin. It rejects path traversal and does not overwrite existing projects.

### Android client

`extensions/android/build.py` builds the maintained Java/WebView client using Android SDK 35 tools and JDK 17. Provide a toolchain directory containing `sdk/` (android.jar, aapt2, d8, zipalign and apksigner) and `jdk/usr/lib/jvm/java-17-openjdk-amd64/`. Set your HTTPS origin at build time:

```sh
WORKBENCH_ORIGIN=https://workbench.example python3 extensions/android/build.py /path/to/toolchain /path/to/private-output
```

Every new output directory receives a fresh signing identity unless `ANDROID_SIGNING_DIR` points to your private persistent signing directory. Keep it outside the repository, retain it for updates and never publish its contents. The update trust key and allowed origin are generated into the build. The build runs download and predictive-back regression tests and verifies APK signatures. No APK from the original deployment is included. Physical-device acceptance is required before distributing your APK.

## Validation

`npm run build` in `extensions/frontend` compiles the gesture adapter and runs its real Chromium regression. `CHROMIUM_PATH` can select your test browser. In `extensions/memory`, `python build.py /path/to/output` runs Python, authorization, model-routing and browser UI checks before emitting a checksummed source snapshot. The memory UI tests also need the frontend sources and their installed test dependencies. Browser gateway tests use `node --test gateway.test.mjs` in `extensions/browser`. Project import tests use `node --test project-import-server.test.mjs`. Android regressions are mandatory in its build script.

Use only temporary test state. Tests must not point at a live installation's database, profile or signing directory.

## Licenses

See [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [DEPENDENCIES.json](DEPENDENCIES.json). Third-party components retain their own licenses and notices. This repository's license does not relicense dependencies or hosted services. The web build regenerates its third-party notice manifest from installed dependencies and refuses packages with missing notice evidence.
