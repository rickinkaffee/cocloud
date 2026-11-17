import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGitHub,command} from './github.mjs';
import {createTemporaryProxy} from './temporary-proxy.mjs';
import {createLocalRunner} from './github-local.mjs';
import {runGitHub} from './github-run.mjs';
import {createServer} from './server.mjs';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'workbench-github-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let active=false,token='',mode='ready',complete,clock=100,codeChunks=[];const calls=[];
 const proxy=createTemporaryProxy({unit:'test.service',proxy:'http://127.0.0.1:17890',ready:async()=>{},stateFile:join(dir,'journal'),control:async action=>{calls.push(action);if(action==='is-active')return active?'active':'inactive';active=action==='start';}});
 const run=async(cmd,args,options={})=>{
  if(args[0]==='auth'&&args[1]==='token')return {code:token?0:1,output:token};
  if(args[0]==='api'){assert.equal(active,true);assert.ok(options.env.HTTPS_PROXY);return mode==='denied'?{code:1,output:'HTTP 401 Bad credentials'}:{code:0,output:'test-account'};}
  if(args[0]==='auth'&&args[1]==='login'){
   assert.equal(active,true);assert.ok(args.includes('--web'));options.onOutput('First copy your one-time code: ABCD-1234','stderr');
   await new Promise(resolve=>{complete=resolve;options.signal.addEventListener('abort',resolve,{once:true});});
   if(!options.signal.aborted&&mode!=='login-failed')token='private-test-credential';return {code:options.signal.aborted||mode==='login-failed'?1:0,output:''};
  }
  return {code:0,output:''};
 };
 const github=createGitHub({proxy,run,now:()=>clock,configDir:join(dir,'gh')});
 return {dir,proxy,github,run,calls,get active(){return active;},setToken(value){token=value;},setMode(value){mode=value;},finish(){complete();},advance(ms=1000){clock+=ms;}};
}
test('polling reads local credential only; explicit connection check verifies account and clears stale credentials',async t=>{
 const f=await fixture(t);assert.equal((await f.github.status()).authenticated,false);assert.deepEqual(f.calls,[]);
 f.setToken('private-test-credential');assert.equal((await f.github.status()).connected,null);
 const value=await f.github.check();assert.equal(value.connected,true);assert.equal(value.account,'test-account');assert.equal(f.active,false);assert.ok(!JSON.stringify(value).includes('private-test-credential'));
 f.setMode('denied');assert.equal((await f.github.check()).connected,false);assert.equal(f.active,false);
 f.setToken('other-credential');assert.equal((await f.github.status()).connected,null);assert.equal((await f.github.status()).account,null);
});
test('device login code is restricted to controllers, cancellation and successful login restore proxy',async t=>{
 const f=await fixture(t);const first=f.github.login();await assert.rejects(f.github.login(),{status:409});let value=await first;assert.equal(value.login.code,'ABCD-1234');assert.equal(f.active,true);assert.equal((await f.github.status(false)).login.code,undefined);
 await assert.rejects(f.github.login(),{status:409});value=await f.github.cancel();assert.equal(value.login.state,'cancelled');assert.equal(value.login.code,undefined);assert.equal(f.active,false);
 await f.github.login();f.finish();while((await f.github.status()).login.state==='pending')await new Promise(r=>setImmediate(r));
 value=await f.github.status();assert.equal(value.authenticated,true);assert.equal(value.connected,true);assert.equal(f.active,false);
 await f.github.login();await f.github.close();assert.equal(f.active,false);
});
test('bounded process runner terminates hung processes and supports cancellation',async()=>{
 const timeout=await command(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:40});assert.notEqual(timeout.code,0);
 const controller=new AbortController();const pending=command(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});controller.abort();assert.notEqual((await pending).code,0);
});
test('local git/gh runner streams exact output and restores proxy on command failure',async t=>{
 const f=await fixture(t);const socket=join(f.dir,'runner.sock');
 const runner=await createLocalRunner({socket,proxy:f.proxy,run:async(cmd,args,options)=>{assert.equal(f.active,true);assert.equal(options.env.HTTPS_PROXY,'http://127.0.0.1:17890');options.onOutput('exact stdout\n','stdout');options.onOutput('failure detail\n','stderr');return {code:7};}});t.after(()=>runner.close());
 let out='',err='';const result=await runGitHub(['git','push','origin','main'],{socket,cwd:f.dir,stdout:{write:x=>out+=x},stderr:{write:x=>err+=x}});
 assert.equal(result,7);assert.equal(out,'exact stdout\n');assert.equal(err,'failure detail\n');assert.equal(f.active,false);
});
test('public routes require authentication, diagnostics, maintenance, settings and exact origin',async t=>{
 const f=await fixture(t);let authenticated=true,scopes=['diagnostics:read'];
 const server=createServer({origin:'https://workbench.example',auth:async()=>({authenticated,permissions:scopes}),github:f.github,proxy:f.proxy});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port+'/api/cocloud/proxy/github';
 const request=(path='',headers={})=>fetch(base+path,{method:path?'POST':'GET',headers:{Origin:'https://workbench.example','X-Cocloud-Proxy':'1',...headers}});
 authenticated=false;assert.equal((await request()).status,401);authenticated=true;
 assert.equal((await (await request()).json()).canControl,false);assert.equal((await request('/login')).status,403);assert.deepEqual(f.calls,[]);
 scopes.push('settings:write','environment:maintain');assert.equal((await request('/check',{Origin:'https://evil.example'})).status,403);assert.equal((await request('/check',{'Sec-Fetch-Site':'cross-site'})).status,403);assert.equal((await request('/check',{'X-Cocloud-Proxy':''})).status,403);
 assert.equal((await request('/check')).status,200);assert.equal(f.active,false);assert.equal((await request('/unknown')).status,404);
});


test('expired device flow releases owned proxy without exposing the code',async t=>{
 const f=await fixture(t);f.setMode('login-failed');await f.github.login();f.advance(1_000_000);f.finish();
 while((await f.github.status()).login.state==='pending')await new Promise(r=>setImmediate(r));
 const value=await f.github.status(true);assert.equal(value.login.state,'expired');assert.equal(value.login.code,undefined);assert.equal(f.active,false);
});
