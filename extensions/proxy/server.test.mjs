import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,speedTest} from './server.mjs';
test('latency tests contact only GitHub and Google, with no bandwidth download',async()=>{
 const calls=[];
 const report=await speedTest(async(...args)=>{calls.push(args);return {label:args[0],ok:true,latencyMs:42}});
 assert.deepEqual(calls,[['GitHub','https://api.github.com/zen'],['Google','https://www.gstatic.com/generate_204']]);
 assert.equal(report.results.length,2);
 assert.ok(!/mbps|bytes|Medium|cloudflare/i.test(JSON.stringify(report)));
});
test('authenticated proxy control, validation, scope enforcement and test serialization',async()=>{
 let authenticated=true,scopes=['diagnostics:read','settings:write'],enabled=true,toggles=0,tests=0,release;
 const server=createServer({origin:'https://workbench.example',auth:async()=>({authenticated,permissions:scopes}),read:async()=>({enabled,startup:enabled}),toggle:async v=>{toggles++;enabled=v;return {enabled,startup:v}},test:async()=>{tests++;await new Promise(r=>release=r);return {results:[{ok:true}]}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}/api/cocloud/proxy`;
 const send=(suffix='',body,headers={})=>fetch(base+suffix,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Cocloud-Proxy':'1',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  authenticated=false;assert.equal((await send()).status,401);assert.equal((await send('',{enabled:false})).status,401);assert.equal(toggles,0);authenticated=true;
  scopes=[];assert.equal((await send()).status,403);scopes=['diagnostics:read'];
  assert.equal((await (await send()).json()).canControl,false);assert.equal((await send('',{enabled:false})).status,403);assert.equal(toggles,0);
  scopes.push('settings:write');assert.equal((await send('',{enabled:false},{Origin:'https://evil.example'})).status,403);
  assert.equal((await send('',{enabled:false},{'X-Cocloud-Proxy':''})).status,403);
  assert.equal((await send('',{enabled:'false'})).status,400);assert.equal(toggles,0);
  assert.equal((await (await send('',{enabled:false})).json()).enabled,false);assert.equal(toggles,1);
  assert.equal((await send('/test',{})).status,409);assert.equal(tests,0);
  await send('',{enabled:true});
  const pending=send('/test',{});
  while(!release)await new Promise(r=>setImmediate(r));
  assert.equal((await send('',{enabled:false})).status,409);assert.equal((await send('/test',{})).status,409);
  release();assert.equal((await pending).status,200);assert.equal((await send('/test',{})).status,200);assert.equal(tests,1);
  assert.equal((await send('/unknown')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
