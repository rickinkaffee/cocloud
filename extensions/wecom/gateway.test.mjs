import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, utimes, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway, workbenchAuth } from './gateway.mjs';

const origin = 'https://workbench.example';
const adminSecret = 'fake-test-only-not-a-real-admin-secret';
const cookie = 'mock=session';
const credentials = { cookie, authorization: 'Basic ' + Buffer.from('admin:' + adminSecret).toString('base64') };
const permission = 'environment:maintain';
async function fixture(context) {
  const dir = await mkdtemp(join(tmpdir(), 'wecom-'));
  const statusFile = join(dir, 'state'), desktopSocket = join(dir, 'desktop.sock');
  const current = { authenticated: true, permissions: [permission] };
  const seen = [];
  const gateway = createGateway({ origin, adminSecret, statusFile, desktopSocket, recheckMs: 25, auth: async headers => {
    assert.deepEqual(headers, { cookie }); return current;
  } });
  const desktop = http.createServer((req, res) => {
    seen.push(req.headers); res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'private=upstream' }); res.end('synthetic desktop');
  });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  context.after(async () => {
    for (const server of [gateway, desktop]) if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  const get = (path, headers = { cookie }) => fetch(base + path, { headers, redirect: 'manual' });
  const status = async () => { const res = await get('/wecom/api/status'); assert.equal(res.status, 200); const body = await res.json(); assert.deepEqual(Object.keys(body).sort(), ['detail','state']); assert.equal(typeof body.detail, 'string'); return body.state; };
  const start = async () => { desktop.listen(desktopSocket); await once(desktop, 'listening'); };
  return { current, desktop, base, statusFile, get, status, start, seen };
}

test('Status requires a workbench session; missing desktop reports offline', async context => {
  const { get, status, current } = await fixture(context);
  assert.equal((await get('/wecom/api/status', {})).status, 401);
  current.permissions = []; assert.equal(await status(), 'offline');
  current.authenticated = false; assert.equal((await get('/wecom/api/status')).status, 401);
});

test('Reachability alone is unknown; fresh online/offline accepted, stale or invalid reports rejected', async context => {
  const { status, statusFile, start } = await fixture(context); await start();
  assert.equal(await status(), 'error');
  for (const [value, expected] of [['online\n','online'],['offline','offline'],['garbage','error']]) {
    await writeFile(statusFile, value, { mode: 0o640 }); assert.equal(await status(), expected);
  }
  await writeFile(statusFile, 'online'); await utimes(statusFile, 0, 0); assert.equal(await status(), 'error');
  await rm(statusFile); await writeFile(statusFile + '.other', 'online'); await symlink(statusFile + '.other', statusFile);
  assert.equal(await status(), 'error');
});

test('Entry and assets require both maintenance permission and admin secret; no credential forwarding', async context => {
  const { get, current, start, seen } = await fixture(context); await start();
  for (const path of ['/wecom/', '/wecom/core/rfb.js']) {
    assert.equal((await get(path)).status, 401);
    current.permissions = []; assert.equal((await get(path, credentials)).status, 403); current.permissions = [permission];
    assert.equal((await get(path, { ...credentials, origin: 'https://other.example' })).status, 403);
  }
  const entry = await get('/wecom/', credentials); assert.equal(entry.status, 302);
  const location = entry.headers.get('location'); assert.equal(new URL(location, origin).searchParams.get('path'), 'wecom/websockify');
  for (const path of [location, '/wecom/core/rfb.js']) {
    const res = await get(path, credentials); assert.equal(await res.text(), 'synthetic desktop'); assert.equal(res.headers.get('set-cookie'), null);
  }
  assert.equal((await get('/wechat/', credentials)).status, 404);
  assert.equal((await get('/wecom/api/messages', credentials)).status, 404);
  assert.equal(seen.length, 2); for (const headers of seen) { assert.equal(headers.cookie, undefined); assert.equal(headers.authorization, undefined); }
});

test('Desktop WebSocket rejects outsiders, relays authorized traffic and closes on revocation', { timeout: 4000 }, async context => {
  const { desktop, base, start, current } = await fixture(context); await start();
  desktop.on('upgrade', (req, peer) => {
    assert.equal(req.url, '/websockify'); assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.authorization, undefined);
    peer.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: test\r\n\r\n'); peer.on('end', () => peer.end()); peer.pipe(peer);
  });
  const upgrade = (headers, path = '/wecom/websockify') => new Promise((resolve, reject) => {
    const req = http.request(base + path, { headers: { connection: 'Upgrade', upgrade: 'websocket', ...headers } });
    req.on('upgrade', (response, socket) => resolve(socket)); req.on('response', response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); req.end();
  });
  assert.equal(await upgrade(credentials), 403); assert.equal(await upgrade({ cookie, origin }), 401);
  assert.equal(await upgrade({ ...credentials, origin }, '/wechat/websockify'), 403);
  const peer = await upgrade({ ...credentials, origin });
  peer.write('mock-frame'); assert.equal((await once(peer, 'data'))[0].toString(), 'mock-frame');
  current.authenticated = false; await once(peer, 'close');
});

test('Workbench auth adapter sends only the session cookie and fails closed on upstream errors', async context => {
  let code = 200;
  const auth = http.createServer((req, res) => {
    assert.equal(req.url, '/api/auth/session'); assert.equal(req.headers.cookie, cookie); assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['x-t3-orchestration-protocol'], '2'); res.writeHead(code); res.end(JSON.stringify({ authenticated: true }));
  });
  auth.listen(0, '127.0.0.1'); await once(auth, 'listening'); context.after(() => auth.close());
  const check = workbenchAuth(`http://127.0.0.1:${auth.address().port}`);
  assert.deepEqual(await check(credentials), { authenticated: true }); code = 503; await assert.rejects(check(credentials));
  assert.throws(() => workbenchAuth('https://public.example'));
});
