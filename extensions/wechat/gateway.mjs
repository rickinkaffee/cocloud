import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function createGateway({auth, origin, password, token, desktop='http://127.0.0.1:6080', api='http://127.0.0.1:8899'}) {
  const sockets = new Set();
  const allowed = (req, write=false) => req.headers['sec-fetch-site'] !== 'cross-site'
    && (!req.headers.origin || req.headers.origin === origin)
    && (!write || req.headers.origin === origin);
  async function authorize(req) {
    if (!allowed(req)) return null;
    const session=await auth(req.headers);
    return session.authenticated && (session.permissions??session.scopes??[]).includes('environment:maintain') ? session : null;
  }
  const reply=(res,status,data,type='application/json; charset=utf-8')=>{
    res.writeHead(status,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);
  };
  function target(req) {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/wechat/desktop/')) return {base:desktop,path:url.pathname.slice('/wechat/desktop'.length)+url.search};
    const path=url.pathname.slice('/wechat/api'.length);
    const routes={GET:['/status','/contacts','/sessions','/messages','/messages/history'],POST:['/messages/send','/messages/reply','/messages/send-file']};
    if(url.pathname.startsWith('/wechat/api/') && routes[req.method]?.includes(path)) return {base:api,path:path+url.search,isApi:true};
    return null;
  }
  function headers(req,t) {
    const h={...req.headers,host:new URL(t.base).host};
    delete h.cookie;delete h.authorization;delete h['x-forwarded-for'];delete h['x-forwarded-host'];
    if(t.isApi)h.authorization='Bearer '+token;
    return h;
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','SAMEORIGIN');
    try {
      const session=await authorize(req);
      if(!session)return reply(res,401,'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><p>请先在同一个浏览器登录工作台，再打开微信试用。</p><a href="/">打开工作台</a>','text/html; charset=utf-8');
      if(session.cookies?.length)res.setHeader('Set-Cookie',session.cookies);
      if(!['GET','HEAD'].includes(req.method)&&!allowed(req,true))return reply(res,403,{error:'origin_rejected'});
      if(req.url==='/wechat') {res.writeHead(302,{Location:'/wechat/'});return res.end();}
      if(req.url==='/wechat/'&&req.method==='GET')return reply(res,200,await readFile(new URL('./index.html',import.meta.url),'utf8'),'text/html; charset=utf-8');
      if(req.url==='/wechat/vnc-config'&&req.method==='GET')return reply(res,200,{password});
      const t=target(req);if(!t)return reply(res,404,{error:'not_found'});
      const upstream=http.request(t.base+t.path,{method:req.method,headers:headers(req,t),timeout:60000},response=>{
        const h={...response.headers,'cache-control':'no-store'};delete h['set-cookie'];
        res.writeHead(response.statusCode,h);response.pipe(res);
      });
      upstream.on('timeout',()=>upstream.destroy());
      upstream.on('error',()=>{if(!res.headersSent)reply(res,502,{error:'微信服务暂未就绪'});else res.destroy();});
      req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
    }catch{if(!res.headersSent)reply(res,503,{error:'登录检查或微信服务暂不可用'});else res.destroy();}
  });
  server.on('upgrade',async(req,socket,head)=>{
    try {
      if(req.headers.origin!==origin||!await authorize(req))throw Error('unauthorized');
      const t=target({...req,method:'GET'});
      if(!t||t.isApi||new URL(req.url,'http://localhost').pathname!=='/wechat/desktop/websockify')throw Error('invalid_path');
      const upstream=http.request(t.base+t.path,{headers:headers(req,t),timeout:10000});
      upstream.on('upgrade',(response,peer,peerHead)=>{
        sockets.add(socket);sockets.add(peer);
        socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');
        if(head.length)peer.write(head);if(peerHead.length)socket.write(peerHead);socket.pipe(peer).pipe(socket);
        let checking=false;
        const timer=setInterval(async()=>{if(checking)return;checking=true;try{if(!await authorize(req)){socket.destroy();peer.destroy();}}catch{socket.destroy();peer.destroy();}finally{checking=false;}},30000);timer.unref();
        socket.on('error',()=>peer.destroy());peer.on('error',()=>socket.destroy());
        socket.on('close',()=>{clearInterval(timer);sockets.delete(socket);peer.destroy();});peer.on('close',()=>{sockets.delete(peer);socket.destroy();});
      });
      upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
      upstream.on('response',r=>{r.resume();socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');});upstream.end();
    }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
  });
  server.on('close',()=>{for(const s of sockets)s.destroy();});
  return server;
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const {authenticateWorkbench}=await import('../project-import/workbench-auth.mjs');
  const {WORKBENCH_ORIGIN:origin,WECHAT_API_TOKEN:token,WECHAT_VNC_PASSWORD:password}=process.env;
  if(!origin||new URL(origin).origin!==origin||!token||!password)throw Error('Set WORKBENCH_ORIGIN, WECHAT_API_TOKEN and WECHAT_VNC_PASSWORD');
  createGateway({auth:authenticateWorkbench,origin,password,token,
    api:process.env.WECHAT_API_URL||'http://127.0.0.1:8899',
    desktop:process.env.WECHAT_DESKTOP_URL||'http://127.0.0.1:6080'})
    .listen(Number(process.env.WECHAT_GATEWAY_PORT||3796),'127.0.0.1');
}
