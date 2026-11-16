import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { authenticateWorkbench } from '../project-import/workbench-auth.mjs';
const publicOrigin=process.env.WORKBENCH_ORIGIN;
if(!publicOrigin || (new URL(publicOrigin).origin!==publicOrigin || new URL(publicOrigin).protocol!=='https:'))throw Error('WORKBENCH_ORIGIN must be a canonical HTTPS origin');
const upstreamOrigin=process.env.BROWSER_UPSTREAM_URL||'http://127.0.0.1:8787';
const browserData=process.env.BROWSER_DATA||'/var/lib/open-workbench-browser';
async function authorize(req){
  if(req.headers.origin && req.headers.origin!==publicOrigin) return false;
  if(req.headers['sec-fetch-site']==='cross-site') return false;
  const auth=await authenticateWorkbench(req.headers);
  const permissions=auth.permissions??auth.scopes??[];
  return auth.authenticated && ['preview:operate','environment:maintain'].every(p=>permissions.includes(p));
}
function headers(req){const h={...req.headers,host:new URL(upstreamOrigin).host};delete h.cookie;delete h.authorization;delete h['x-forwarded-for'];if(h.origin)h.origin=upstreamOrigin;return h;}
async function target(req){
  const {url}=JSON.parse(await readFile(browserData+'/run/endpoint.json','utf8'));
  const base=new URL(url).pathname;
  if(req.url==='/floe'||req.url==='/floe/')return {entry:base};
  if(!req.url?.startsWith(base))return null;
  return {path:req.url};
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  try{
    if(!await authorize(req)){res.writeHead(401,{'content-type':'text/html; charset=utf-8'});res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><p>请先在同一个浏览器登录工作台，再返回此页面。</p><a href="/">打开工作台登录</a>');return;}
    const t=await target(req);if(!t){res.writeHead(404).end();return;}
    if(t.entry){res.writeHead(302,{Location:t.entry}).end();return;}
    if(t.path.endsWith('/touch-scroll.js') && req.method==='GET'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(await readFile(new URL('./touch-scroll.js',import.meta.url)));return;}
    const upstream=http.request(upstreamOrigin+t.path,{method:req.method,headers:headers(req)},response=>{
      if(response.statusCode===200 && /^\/session\/[a-zA-Z0-9_-]+\/$/.test(t.path) && response.headers['content-type']?.startsWith('text/html')){
        const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{
          const html=Buffer.concat(chunks).toString('utf8').replace('</body>','<script type="module" src="./touch-scroll.js"></script></body>');
          const h={...response.headers};delete h['content-length'];delete h['content-encoding'];h['x-frame-options']='SAMEORIGIN';if(h['content-security-policy'])h['content-security-policy']=h['content-security-policy'].replace("frame-ancestors 'none'","frame-ancestors 'self'");res.writeHead(200,h);res.end(html);
        });
      }else{res.writeHead(response.statusCode,response.headers);response.pipe(res);}
    });
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Browser unavailable');});req.pipe(upstream);req.on('aborted',()=>upstream.destroy());
  }catch{if(!res.headersSent)res.writeHead(503);res.end('Browser temporarily unavailable');}
});
server.on('upgrade',async(req,socket,head)=>{
  try{
    if(req.headers.origin!==publicOrigin||!await authorize(req))throw Error('Forbidden');
    const t=await target(req);if(!t?.path)throw Error('Invalid path');
    const upstream=http.request(upstreamOrigin+t.path,{headers:headers(req)});
    upstream.on('upgrade',(response,peer,peerHead)=>{
      socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');
      if(head.length)peer.write(head);if(peerHead.length)socket.write(peerHead);socket.pipe(peer).pipe(socket);
      let checking=false;const timer=setInterval(async()=>{if(checking)return;checking=true;try{if(!await authorize(req)){socket.destroy();peer.destroy();}}catch{socket.destroy();peer.destroy();}finally{checking=false;}},30000);timer.unref();
      socket.on('close',()=>{clearInterval(timer);peer.destroy();});peer.on('close',()=>socket.destroy());peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
    });
    upstream.on('response',response=>{socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`);response.resume();});
    upstream.on('error',()=>socket.destroy());upstream.end();
  }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
});
server.listen(Number(process.env.BROWSER_GATEWAY_PORT||3780),'127.0.0.1',()=>console.log('Authenticated Floe gateway ready.'));
