import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const source = fs.readFileSync(new URL('../assets/blob-download.js', import.meta.url), 'utf8');
const origin = 'https://workbench.example';
const urls = new Map(), listeners = new Map();
let clicks = 0, fetches = 0;
class Anchor { click() { clicks++; } }
const ctx = vm.createContext({
  window: {}, location: {origin}, HTMLAnchorElement: Anchor,
  document: {addEventListener: (type, fn) => listeners.set(type, fn)},
  fetch: url => { fetches++; const blob = urls.get(url); return blob ? Promise.resolve({blob: async () => blob}) : Promise.reject(Error('Revoked URL')); },
  setTimeout: fn => { /* retention TTL is irrelevant for deterministic transport tests */ },
  Uint8Array, btoa: text => Buffer.from(text, 'binary').toString('base64')
});
vm.runInContext(source, ctx); const click = Anchor.prototype.click;
vm.runInContext(source, ctx); assert.equal(Anchor.prototype.click, click, 'idempotent install');
const api = ctx.window.__cocloudDownloadsV1;
const tick = () => new Promise(r => setImmediate(r));
async function receive(id) {
  for (let tries = 0; api.info(id).phase === 'loading' && tries < 100; tries++) await tick();
  const info = api.info(id); assert.equal(info.phase, 'ready', info.error);
  const blocks = []; let offset = 0;
  while (offset < info.size) {
    let chunk;
    for (let tries = 0; tries < 100; tries++) { chunk = api.pull(id, offset); if (!chunk.pending) break; await tick(); }
    assert.equal(chunk.offset, offset); assert.equal(chunk.pending, false); assert.ok(!chunk.error);
    const bytes = Buffer.from(chunk.data, 'base64'); assert.ok(bytes.length <= 192 * 1024 && bytes.length > 0);
    blocks.push(bytes); offset += bytes.length;
  }
  api.cancel(id); return {bytes: Buffer.concat(blocks), info};
}
// Exactly the old frontend save path: create URL, detached anchor.click(), revoke immediately.
// This test intentionally knows nothing about hashed bundle names or Android-specific frontend helpers.
for (const [name, bytes, mime] of [
  ['女孩.png', Buffer.from(Array.from({length: 4873467}, (_, i) => i % 251)), 'image/png'],
  ['report.json', Buffer.from('{"result":"成功"}'), 'application/json'],
  ['empty.txt', Buffer.alloc(0), 'text/plain']
]) {
  const url = origin.replace('https:', 'blob:https:') + '/' + name;
  urls.set(url, new Blob([bytes], {type:mime}));
  const a = new Anchor(); a.href = url; a.download = name; a.click();
  urls.delete(url); // frontend's revokeObjectURL
  api.begin(name, url); const result = await receive(name);
  assert.equal(result.info.name, name); assert.equal(result.info.mime, mime);
  assert.equal(createHash('sha256').update(result.bytes).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
}
assert.equal(clicks, 3);
assert.throws(() => api.begin('bad', 'blob:https://evil.test/id'));
urls.set('blob:' + origin + '/large', {size: 64 * 1024 * 1024 + 1});
api.begin('large', 'blob:' + origin + '/large'); await tick(); assert.equal(api.info('large').phase, 'error'); api.cancel('large');
api.begin('gone', 'blob:' + origin + '/gone'); await tick(); assert.equal(api.info('gone').phase, 'error'); api.cancel('gone');
urls.set('blob:' + origin + '/cancel', new Blob(['cancel']));
api.begin('cancel', 'blob:' + origin + '/cancel'); api.cancel('cancel'); await tick(); assert.equal(api.info('cancel').phase, 'error');
console.log('Blob transport regression passed: unpatched frontend, immediate revoke, multi-chunk PNG hash, JSON, empty file, rejected origin, oversize, failed fetch, cancellation.');
