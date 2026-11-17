# Server proxy settings

Optional authenticated control bridge for an administrator-provided local proxy.
The sidebar has a sliding enable/disable switch and **Google/GitHub connection
latency only**. It does not run download/bandwidth tests. Proxy subscriptions,
node configuration, credentials and a proxy executable are not distributed here.
No new npm dependency is needed; use Node 24+, curl and systemd.

1. Install your own HTTP or SOCKS proxy bound to loopback. Its service should be
   named `workbench-outbound-proxy.service`, or set `PROXY_SERVICE` to your unit.
2. Create a private environment file from `../../config/proxy.env.example`.
   Set `WORKBENCH_ORIGIN` to your canonical HTTPS workbench origin. The internal
   authentication endpoint defaults to `http://127.0.0.1:3773`.
3. Run `python3 build.py /path/to/private-release` to run mandatory regressions
   and emit a checksummed source release. Copy its `proxy/` and `project-import/`
   directories into your installation's `extensions/` directory, then adapt the
   supplied `workbench-proxy-control.service` paths to your installation.
4. Proxy `/api/cocloud/proxy*` to `127.0.0.1:3794` in your HTTPS gateway:

   ```caddyfile
   handle /api/cocloud/proxy* {
     reverse_proxy 127.0.0.1:3794
   }
   ```

The maintained web component is `../frontend/src/proxy-entry.js`, mirrored in
`../../core/apps/web/src/extensions/proxy-entry.js` and mounted by
`WorkbenchExtensions.tsx`. Rebuild the core web app through the documented
`scripts/build-core.sh` workflow; the bridge alone does not update the UI.
Run `node ../frontend/tests/proxy-entry.mjs` for UI state regressions.

Status requires a workbench session with `diagnostics:read`. Changes and tests
also require `settings:write`, a same-origin request and the custom request
header. Cross-site fetches are rejected. Testing contacts only two fixed HTTPS
URLs, uses bounded timeouts, serializes with toggles and caches for 15 seconds.
Neither controller credentials nor subscription data are read by this bridge.

The toggle starts/stops the configured systemd unit and enables/disables startup.
It does not set global proxy environment variables: clients must explicitly use
`PROXY_URL`. Services using that same proxy will be affected when it is disabled.
The bridge needs permission to manage **only that configured unit**; the example
root service is for an administrator-controlled single-host deployment. Keep its
API loopback-only behind workbench authentication. Do not grant systemd control
to an untrusted user. Use your own service policy for a multi-user installation.


## GitHub login and temporary connectivity

The connection center shows whether `gh` is installed, whether a local login is
configured, and the result/time/account of the last explicit connection check.
A configured credential alone does not imply a working connection. Polling reads
local credentials without contacting GitHub or starting the proxy. Device login
opens GitHub's own authorization page; no access token is entered into the UI.
The code is visible only to a session with diagnostics, settings-write and
maintenance scopes. Login and checks require the configured origin and custom
request header. Credentials stay in the server user's private `gh` configuration.
Install `gh`, create its configuration directory with mode 0700, and set
`GH_CONFIG_DIR` consistently for the bridge, workbench server and command-line user.
The supplied unit requires `/var/lib/open-workbench/.config/gh` to exist before start.

Login, connection checks and managed GitHub commands start the configured proxy
with `systemctl start` only when it was inactive. They restore that runtime state
after success, failure, cancellation or timeout. An already running proxy stays
running; startup/enable state is never changed by temporary operations. Concurrent
operations and manual proxy changes are refused while one is running. A private
ownership journal and the unit's `ExecStopPost --recover` restore an owned proxy
if the bridge crashes or is killed. Keep `PROXY_STATE_DIR` persistent and use the
provided unit's recovery hook when adapting installation paths.

Use the owner-only local runner for GitHub operations that need this lifecycle:

```sh
node extensions/proxy/github-run.mjs git push origin main
node extensions/proxy/github-run.mjs gh pr list
```

The bridge's Unix socket is owner-only; no public command-execution route exists.
Commands use the same private `gh` configuration and a transient GitHub credential
helper, receive proxy variables only in their child process, stream output, and
have a 15-minute deadline. Disconnecting the runner cancels the child and restores
the proxy. Ordinary commands outside this runner keep their existing behavior.
No global proxy, Git configuration or boot-time service setting is modified.
Tests use mock credentials/services and cover process deadlines, interrupted
cleanup, cancellation, concurrency, exact output and API permissions.
