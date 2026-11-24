import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createGateway} from './gateway.mjs';

test('workbench authentication protects desktop, credentials, API and websocket',async t=>{
  const origin='https://workbench.test';let upstreamHeaders;const peers=new Set();
  const upstream=http.createServer((req,res)=>{upstreamHeaders=req.headers;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/status'?{status:'已登录',db_available:true}:{path:req.url}));});
  upstream.on('upgrade',(req,socket)=>{
    peers.add(socket);socket.on('close',()=>peers.delete(socket));socket.on('error',()=>{});
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const upstreamUrl='http://127.0.0.1:'+upstream.address().port;
  const gateway=createGateway({origin,password:'test-vnc-password',token:'test-api-token',api:upstreamUrl,desktop:upstreamUrl,
    auth:async h=>({authenticated:h.cookie==='paired=yes',permissions:h['x-test-readonly']?[]:['environment:maintain']})});
  gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
  const base='http://127.0.0.1:'+gateway.address().port;
  t.after(()=>{for(const s of peers)s.destroy();gateway.close();upstream.close();});
  const paired={cookie:'paired=yes'};
  for(const path of ['/wechat/','/wechat/vnc-config','/wechat/api/status','/wechat/desktop/vnc.html'])assert.equal((await fetch(base+path)).status,401);
  assert.equal((await fetch(base+'/wechat/vnc-config',{headers:{...paired,'x-test-readonly':'yes'}})).status,401);
  assert.equal((await fetch(base+'/wechat/vnc-config',{headers:{...paired,origin:'https://evil.test'}})).status,401);
  assert.equal((await fetch(base+'/wechat/',{headers:paired})).status,200);
  assert.deepEqual(await (await fetch(base+'/wechat/vnc-config',{headers:paired})).json(),{password:'test-vnc-password'});
  assert.deepEqual(await (await fetch(base+'/wechat/api/messages?after=2',{headers:paired})).json(),{path:'/messages?after=2'});
  assert.deepEqual(await (await fetch(base+'/wechat/api/status',{headers:paired})).json(),{status:'已登录',db_available:true});
  assert.equal(upstreamHeaders.cookie,undefined);assert.equal(upstreamHeaders.authorization,'Bearer test-api-token');
  assert.equal((await fetch(base+'/wechat/api/command',{method:'POST',headers:{...paired,origin}})).status,404);
  assert.equal((await fetch(base+'/wechat/api/messages/send',{method:'POST',headers:paired})).status,403);
  assert.equal((await fetch(base+'/wechat/api/messages/send',{method:'POST',headers:{...paired,origin},body:'{}'})).status,200);
  assert.equal((await fetch(base+'/wechat/desktop/core/rfb.js',{headers:paired})).status,200);
  assert.equal(upstreamHeaders.cookie,undefined);assert.equal(upstreamHeaders.authorization,undefined);
  const upgrade=(headers={})=>new Promise((resolve,reject)=>{
    const req=http.request(base+'/wechat/desktop/websockify',{headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ==',...headers}});
    req.on('response',r=>{r.resume();resolve(r.statusCode);});
    req.on('upgrade',(r,s)=>{s.destroy();resolve(r.statusCode);});req.on('error',reject);req.end();
  });
  assert.equal(await upgrade({origin}),403);
  assert.equal(await upgrade({...paired,origin:'https://evil.test'}),403);
  assert.equal(await upgrade({...paired,origin}),101);
});
