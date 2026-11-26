import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createAihubReader } from './aihub-reader.mjs';
process.env.AIHUB_BASE_URL = 'https://provider.example';
import { createBalanceServer, combinedReader } from './balance-server.mjs';
const dir = await mkdtemp(tmpdir() + '/balance-test-');
try {
  const credentialPath = dir + '/credential.json';
  await writeFile(credentialPath, JSON.stringify({ token: 'test-only' }));
  const readBalance = createAihubReader({ credentialPath, now: () => Date.parse('2026-11-16T17:00:00Z'), fetcher: async (url, options) => {
    assert.equal(url.hostname, 'provider.example');
    assert.equal(url.searchParams.get('start_date'), '2026-11-17');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    return Response.json({ remaining: '12.34', isValid: true, usage: { today: { actual_cost: 2.5 } }, model_stats: [{ model: 'gpt-6.1-sol', actual_cost: 2.5 }] });
  }});
  const server = createBalanceServer({ authenticate: async headers => ({ authenticated: headers.authorization === 'test', scopes: ['diagnostics:read'] }), readBalance });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/cocloud/balance`;
    assert.equal((await fetch(url)).status, 401);
    const result = await (await fetch(url, { headers: { Authorization: 'test' } })).json();
    assert.deepEqual(result.accounts, [{ id: 'aihub', ok: true, remaining: 12.34, isValid: true }, {id:'sydney',ok:false,remaining:null,isValid:false}]);
    const key = dir + '/sydney'; await writeFile(key,'fake');
    const sydney = createAihubReader({id:'sydney',credentialPath:key,fetcher:async (url,options)=>{assert.equal(url.origin,'https://api.sydney-ai.com');assert.equal(options.headers.Authorization,'Bearer fake');return Response.json(url.pathname.endsWith('/usage')?{total_usage:125}:{hard_limit_usd:1.25});}});
    const partial = await combinedReader([async()=>{throw Error('offline')},sydney])();
    assert.equal(partial.accounts[0].remaining,0); assert.equal(partial.daily.sydney.cost,null);
    assert.equal(result.daily.aihub.cost, 2.5);
    assert(!JSON.stringify(result).includes('test-only'));
    const invalid = createAihubReader({ credentialPath, fetcher: async () => Response.json({ remaining: null }) });
    await assert.rejects(invalid(), /Invalid balance/);
  } finally { await new Promise(resolve => server.close(resolve)); }
} finally { await rm(dir, { recursive: true }); }
console.log('Balance regression passed: independent upstream, date, auth, sanitization, invalid data');

let reads = 0, scopes = ['orchestration:read'], fail = false;
const catalogServer = createBalanceServer({
  authenticate: async headers => ({ authenticated: headers.authorization === 'test', scopes }),
  readModels: async id => { reads++; assert.equal(id, 'codex'); if (fail) throw Error('private credential details');
    return { instanceId: id, environmentId: 'environment', models: [{ slug: 'gpt-6.2-sol', name: 'GPT-6.2 Sol' }] }; },
});
await new Promise(resolve => catalogServer.listen(0, '127.0.0.1', resolve));
try {
  const url = `http://127.0.0.1:${catalogServer.address().port}/api/cocloud/balance?resource=models&instanceId=codex`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal(reads, 0);
  scopes = [];
  assert.equal((await fetch(url, { headers: { Authorization: 'test' } })).status, 403);
  assert.equal(reads, 0);
  scopes = ['orchestration:read'];
  const response = await fetch(url, { headers: { Authorization: 'test' } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).models[0].slug, 'gpt-6.2-sol');
  fail = true;
  const failed = await fetch(url, { headers: { Authorization: 'test' } });
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'model_catalog_unavailable' });
} finally { await new Promise(resolve => catalogServer.close(resolve)); }
console.log('Model discovery HTTP regression passed: auth, scopes, on-demand catalog, no-store and sanitized failures');
