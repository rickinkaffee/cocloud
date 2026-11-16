# Optional WeChat gateway

This adapter connects the connection-center status card and `/wechat/` to an
administrator-provided compatible WeChat API and noVNC desktop. It does not
install or distribute WeChat, a signed-in account, API server, desktop, noVNC,
contacts, messages, database keys or runtime configuration.

Create a private environment file from `../../config/wechat.env.example`, set
your canonical HTTPS origin and your own API/VNC credentials, then run Node 24+
`node gateway.mjs`. Proxy `/wechat*`, including WebSocket upgrades, to loopback
3796. Both upstream services should remain on private interfaces. The upstream
API must supply `GET /status` with `{status: string, db_available: boolean}`;
the desktop must supply noVNC files at `/core/rfb.js` and `/websockify`.

Every HTTP request validates the workbench session and `environment:maintain`.
Mutations require the configured origin; desktop WebSockets check origin and
revalidate authorization. Workbench cookies and tokens are stripped before
proxying, and only the deployer's API token goes to the API. Missing services
produce an unavailable status, never a fabricated online result. No outgoing
message is sent by status polling; message actions require an explicit UI action.

Run `node --test gateway.test.mjs`. Use your own account to accept login and
message behavior after installing your chosen compatible upstream separately.
