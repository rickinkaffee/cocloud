import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTemporaryProxy,waitForProxy} from './temporary-proxy.mjs';
async function fixture(t,active=false){
 const dir=await mkdtemp(join(tmpdir(),'workbench-proxy-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls=[];let failStart=false,failStop=false;
 const options={unit:'test.service',proxy:'http://127.0.0.1:17890',ready:async()=>{},stateFile:join(dir,'owned.json'),control:async action=>{
  calls.push(action);if(action==='is-active')return active?'active':'inactive';
  if(action==='start'){active=true;if(failStart)throw Error('start failed');}
  if(action==='stop'){if(failStop)throw Error('stop failed');active=false;}
 }};
 return {options,calls,get active(){return active;},startFailure(){failStart=true;},stopFailure(value){failStop=value;},proxy:createTemporaryProxy(options)};
}
test('temporary operations restore runtime state on success and failure, without touching startup',async t=>{
 for(const active of [false,true])for(const failure of [false,true]){
  const f=await fixture(t,active);
  const work=f.proxy.run(async env=>{assert.equal(f.active,true);assert.equal(env.HTTPS_PROXY,f.options.proxy);if(failure)throw Error('failed');return 7;});
  if(failure)await assert.rejects(work,/failed/);else assert.equal(await work,7);
  assert.equal(f.active,active);assert.equal(f.proxy.busy,false);assert.equal(f.proxy.temporary,false);
  assert.deepEqual(f.calls,active?['is-active']:['is-active','start','stop']);
  await assert.rejects(readFile(f.options.stateFile),{code:'ENOENT'});
 }
});
test('concurrent GitHub and manual changes cannot stop a running task',async t=>{
 const f=await fixture(t);let release,started;
 const ready=new Promise(r=>started=r);
 const first=f.proxy.run(async()=>{started();await new Promise(r=>release=r);});await ready;
 await assert.rejects(f.proxy.run(async()=>{}),{status:409});await assert.rejects(f.proxy.exclusive(async()=>{}),{status:409});assert.equal(f.active,true);
 release();await first;assert.equal(f.active,false);
});
test('start failure is cleaned up; interrupted service ownership is recovered after restart',async t=>{
 const f=await fixture(t);f.startFailure();await assert.rejects(f.proxy.run(async()=>{}),/start failed/);assert.equal(f.active,false);
 await writeFile(f.options.stateFile,JSON.stringify({version:1,unit:f.options.unit,owned:true}));
 await createTemporaryProxy(f.options).recover();assert.equal(f.calls.at(-1),'stop');await assert.rejects(readFile(f.options.stateFile),{code:'ENOENT'});
});
test('failed cleanup retains recovery journal; next operation must recover first',async t=>{
 const f=await fixture(t);f.stopFailure(true);await assert.rejects(f.proxy.run(async()=>{}),/stop failed/);assert.equal(f.proxy.temporary,true);assert.equal(JSON.parse(await readFile(f.options.stateFile)).owned,true);
 f.stopFailure(false);await f.proxy.exclusive(async()=>assert.equal(f.active,false));assert.equal(f.proxy.temporary,false);
});


test('proxy readiness waits for delayed listener and rejects an unavailable one',async t=>{
 const {createServer}=await import('node:net');
 const server=createServer(socket=>socket.end());
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 const waiting=waitForProxy('http://127.0.0.1:'+port,2000);
 setTimeout(()=>server.listen(port,'127.0.0.1'),60);
 await waiting;await new Promise(resolve=>server.close(resolve));
 await assert.rejects(waitForProxy('http://127.0.0.1:'+port,100),/did not become ready/);
});
