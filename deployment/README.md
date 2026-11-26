# Web workbench source snapshot

`frontend/src` contains the maintained frontend inputs of the 2026-11-26 web release. The SSH host list and project display names are installation configuration (`WORKBENCH_SSH_HOSTS` and `WORKBENCH_SSH_PROJECT_NAMES`); both default to empty. These files include adapters for the packaged web client, not a standalone frontend application.

`backend/changes.json` contains the customized JavaScript changes against the T3 Code v0.1.8 Linux x64 release. The original third-party executable and its bundled dependencies are not redistributed here. To reproduce the customized backend module in a new, empty directory, set `ROOT` to the absolute checkout path and `T3` to the absolute path of the original release executable:

```sh
WORKBENCH_EXTRACT_TO="$PWD/base.mjs" NODE_OPTIONS="--require=$ROOT/deployment/backend/extract.cjs" "$T3" --help
python3 "$ROOT/deployment/backend/restore.py" base.mjs binMain.mjs
node --check binMain.mjs
```

The restoration verifies both the input and output SHA-256; a different upstream build is rejected. This reconstructs the bundled backend module, not TypeScript sources or a complete installation. For the portable source deployment, follow the main README. Configure your own accounts and services; never copy another installation's state or credentials.
