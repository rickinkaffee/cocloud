import http from 'node:http';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = value => createHash('sha256').update(value).digest();
const state = (state, detail) => ({ state, detail });
const unavailable = state('error', 'Login state is not verified.');

async function desktopStatus(socketPath, statusFile) {
  try {
    const status = await new Promise((resolve, reject) => {
      http.request({ socketPath, path: '/vnc.html', method: 'HEAD', signal: AbortSignal.timeout(2000) }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject).end();
    });
    if (status !== 200) return state('error', 'Desktop health check failed.');
  } catch (error) {
    return ['ENOENT', 'ECONNREFUSED'].includes(error.code) ? state('offline', 'Desktop unavailable.') : state('error', 'Desktop health check failed.');
  }
  let file;
  try {
    file = await open(statusFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    const age = Date.now() - stat.mtimeMs;
    if (!stat.isFile() || stat.mode & 0o022 || stat.size > 8 || age < -1 || age > 60000) return unavailable;
    const buffer = Buffer.alloc(9);
    const { bytesRead } = await file.read(buffer);
    const value = buffer.toString('utf8', 0, bytesRead).replace(/\n$/, '');
    return ['online', 'offline'].includes(value) ? state(value, 'Reported by the configured login-state source.') : unavailable;
  } catch { return unavailable; } finally { await file?.close(); }
}

export function workbenchAuth(base) {
  const internal = new URL(base);
  if (internal.protocol !== 'http:' || internal.hostname !== '127.0.0.1' || internal.origin !== base) throw Error('Expected loopback workbench origin');
  return async ({ cookie }) => {
    const response = await fetch(new URL('/api/auth/session', internal), { headers: { cookie, 'x-t3-orchestration-protocol': '2' }, redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) { await response.body?.cancel(); throw Error('Auth unavailable'); }
    return response.json();
  };
}

export function createGateway({ auth, origin, adminSecret, desktopSocket, statusFile, recheckMs = 30000 }) {
  const site = new URL(origin);
  if (site.origin !== origin || site.protocol !== 'https:' || !adminSecret || adminSecret.length < 32 || !isAbsolute(desktopSocket) || !isAbsolute(statusFile)) throw Error('Invalid WeCom configuration');
  const adminHash = digest('Basic ' + Buffer.from('admin:' + adminSecret).toString('base64'));
  const entry = '/wecom/vnc.html?' + new URLSearchParams({ autoconnect: '1', path: 'wecom/websockify', host: site.hostname, port: site.port || '443', encrypt: 'true' });
  async function access(req, desktop) {
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin !== undefined && req.headers.origin !== origin)) return 403;
    if (!req.headers.cookie) return 401;
    const session = await auth({ cookie: req.headers.cookie });
    if (session?.authenticated !== true) return 401;
    if (!desktop) return 200;
    if (!Array.isArray(session.permissions) || !session.permissions.includes('environment:maintain')) return 403;
    return timingSafeEqual(adminHash, digest(req.headers.authorization || '')) ? 200 : 401;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', `frame-ancestors 'none'; base-uri 'none'; form-action 'none'; connect-src 'self' wss://${site.host}`);
    const statusRoute = req.url === '/wecom/api/status';
    const reply = (code, message) => {
      res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(message));
    };
    try {
      if (req.url === '/wecom') { res.writeHead(302, { location: '/wecom/' }); return res.end(); }
      if (!req.url.startsWith('/wecom/')) return reply(404, { error: 'not_found' });
      const result = await access(req, !statusRoute);
      if (result !== 200) {
        if (result === 401 && !statusRoute && req.headers.cookie) res.setHeader('WWW-Authenticate', 'Basic realm="WeCom desktop"');
        return reply(result, state('error', 'Access denied.'));
      }
      if (req.method !== 'GET' && (req.method !== 'HEAD' || statusRoute)) return reply(405, state('error', 'Method not allowed.'));
      if (statusRoute) return reply(200, await desktopStatus(desktopSocket, statusFile));
      if (req.url === '/wecom/') { res.writeHead(302, { location: entry }); return res.end(); }
      const path = req.url === entry ? '/vnc.html' : req.url.slice('/wecom'.length);
      if (req.url !== entry && !/^\/(?:app|core|vendor)\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/.test(path)) return reply(404, { error: 'not_found' });
      const upstream = http.request({ socketPath: desktopSocket, path, method: req.method, signal: AbortSignal.timeout(10000) }, response => {
        if (response.statusCode !== 200) { response.resume(); return reply(502, { error: 'desktop_unavailable' }); }
        res.writeHead(200, { 'content-type': response.headers['content-type'] || 'application/octet-stream' });
        response.on('error', () => res.destroy()).pipe(res);
      });
      res.on('close', () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent && !res.destroyed) reply(502, { error: 'desktop_unavailable' }); else res.destroy(); }).end();
    } catch { if (!res.headersSent) reply(503, state('error', 'Service unavailable.')); else res.destroy(); }
  });
  server.on('upgrade', async (req, client, head) => {
    client.on('error', () => client.destroy());
    const deny = code => client.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    try {
      if (req.method !== 'GET' || req.url !== '/wecom/websockify' || req.headers.origin !== origin || req.headers.upgrade?.toLowerCase() !== 'websocket') return deny(403);
      const result = await access(req, true);
      if (result !== 200) return deny(result);
      const headers = { connection: 'Upgrade', upgrade: 'websocket' };
      for (const name of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol']) if (req.headers[name]) headers[name] = req.headers[name];
      const upstream = http.request({ socketPath: desktopSocket, path: '/websockify', headers });
      const deadline = setTimeout(() => upstream.destroy(), 5000);
      client.once('close', () => upstream.destroy());
      upstream.once('error', () => { clearTimeout(deadline); client.destroy(); });
      upstream.once('response', response => { clearTimeout(deadline); response.resume(); deny(502); });
      upstream.once('upgrade', (response, peer, peerHead) => {
        clearTimeout(deadline);
        if (client.destroyed || response.statusCode !== 101) { peer.destroy(); client.destroy(); return; }
        const accept = response.headers['sec-websocket-accept'];
        const protocol = response.headers['sec-websocket-protocol'];
        client.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n${protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : ''}\r\n`);
        let checking = false;
        const timer = setInterval(async () => {
          if (checking) return;
          checking = true;
          try { if (await access(req, true) !== 200) client.destroy(); } catch { client.destroy(); } finally { checking = false; }
        }, recheckMs).unref();
        client.once('close', () => { clearInterval(timer); peer.destroy(); }); peer.once('close', () => client.destroy());
        peer.on('error', () => client.destroy());
        if (head.length) peer.write(head); if (peerHead.length) client.write(peerHead);
        client.pipe(peer).pipe(client);
      });
      upstream.end();
    } catch { deny(503); }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  createGateway({ auth: workbenchAuth(env.WORKBENCH_INTERNAL_URL || 'http://127.0.0.1:3773'), origin: env.WORKBENCH_ORIGIN,
    adminSecret: env.WECOM_ADMIN_SECRET, desktopSocket: env.WECOM_DESKTOP_SOCKET || '/run/wecom-desktop/http.sock', statusFile: env.WECOM_STATUS_FILE || '/run/wecom-desktop/login.state' })
    .listen(Number(env.WECOM_GATEWAY_PORT || 3797), '127.0.0.1');
}
