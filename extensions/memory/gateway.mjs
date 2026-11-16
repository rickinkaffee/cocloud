import http from 'node:http';
import {createUsageWriter} from './usage-writer.mjs';
import {modelCatalogue,runModel} from './model-router.mjs';
import {allowed} from './auth-policy.mjs';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {authenticateWorkbench} from '../project-import/workbench-auth.mjs';

const root=process.env.MEMORY_DATA||'/var/lib/open-workbench-memory';
const db=new DatabaseSync(root+'/catalog.sqlite');db.exec('PRAGMA busy_timeout=100');
const token=(await fs.readFile(root+'/bridge-token','utf8')).trim();
let busy=0;let stats={requests:0,inputTokens:0,outputTokens:0,errors:0};
try{stats=JSON.parse(db.prepare('SELECT value FROM state WHERE key=?').get('usage').value)}catch{}
const record=createUsageWriter(db,()=>stats);
async function read(req,limit=2*1024*1024){let parts=[],n=0;for await(const part of req){n+=part.length;if(n>limit)throw Error('body too large');parts.push(part)}return Buffer.concat(parts)}
function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
// Private model bridge reads credentials only from the process environment.
http.createServer(async(req,res)=>{
 try{
  if(req.headers.authorization!=='Bearer '+token)return json(res,401,{error:'unauthorized'});
  if(req.method!=='POST'||req.url!=='/v1/chat/completions')return json(res,404,{error:'not found'});
  const blocked=JSON.parse(db.prepare('SELECT value FROM state WHERE key=?').get('modelBlock')?.value||'null');
  if(blocked?.reason)return json(res,402,{error:{message:blocked.reason,type:'insufficient_balance'}});
  if(busy>=2)return json(res,429,{error:{message:'memory concurrency limit',type:'rate_limit_error'}});
  const body=JSON.parse(await read(req));
  busy++;try{
   const selection=JSON.parse(db.prepare('SELECT value FROM state WHERE key=?').get('modelSelection')?.value||'null');
   stats.requests++;
   if(selection){
    const result=await runModel(body,selection);
    stats.inputTokens+=result.value?.usage?.prompt_tokens||0;stats.outputTokens+=result.value?.usage?.completion_tokens||0;
    if(result.status!==200)stats.errors++;
    if(result.status===402){db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run('paused','true');db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run('modelBlock',JSON.stringify({reason:selection.model+' 余额不足，整理已暂停；充值或更换模型后继续。',at:Date.now()/1000}));}
    record();return json(res,result.status,result.value);
   }
   const base=process.env.MEMORY_MODEL_BASE_URL?.replace(/\/$/,'');const apiKey=process.env.MEMORY_MODEL_API_KEY;if(!base||!apiKey)throw Error('Memory model is not configured');
   const upstream=await fetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify({...body,model:process.env.MEMORY_MODEL_ID,stream:false}),signal:AbortSignal.timeout(240000)});
   const text=await upstream.text();let value;try{value=JSON.parse(text)}catch{}
   if(upstream.status===402){
    db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run('modelBlock',JSON.stringify({reason:'模型服务余额不足（402），整理已自动暂停。充值后点击继续整理，再重试失败批次。',at:Date.now()/1000}));
    db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run('paused','true');
   }
   stats.inputTokens+=value?.usage?.prompt_tokens||0;stats.outputTokens+=value?.usage?.completion_tokens||0;if(!upstream.ok)stats.errors++;record();
   res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(text);
  }finally{busy--}
 }catch(e){stats.errors++;record();json(res,502,{error:{type:'memory_bridge_error',message:e.name}})}
}).listen(3792,'127.0.0.1');
http.createServer(async(req,res)=>{
 try{
  const auth=await authenticateWorkbench(req.headers);if(auth.cookies?.length)res.setHeader('Set-Cookie',auth.cookies);
  if(!auth.authenticated){if(req.url.startsWith('/memory')){res.writeHead(302,{Location:'/'});res.end();return}return json(res,401,{error:'请先登录工作台'})}
  if(!allowed(auth,req.url))return json(res,403,{error:'记忆中心需要工作台管理权限'});
  if(req.method!=='GET'){
   if(req.headers['x-memory-request']!=='1')return json(res,403,{error:'request header required'});
   if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'origin rejected'});
  }
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/cocloud/memory/models'){
   if(req.method!=='GET')return json(res,405,{error:'method not allowed'});
   return json(res,200,{...await modelCatalogue(),selection:JSON.parse(db.prepare('SELECT value FROM state WHERE key=?').get('modelSelection')?.value||'null')});
  }
  if(url.pathname==='/api/cocloud/memory/model'){
   if(req.method!=='POST')return json(res,405,{error:'method not allowed'});
   if(busy)return json(res,409,{error:'当前批次正在使用模型，请稍后保存'});
   const chosen=JSON.parse(await read(req,12000)),catalog=await modelCatalogue(true);
   if(!catalog.models.some(m=>m.id===chosen.model&&m.provider===chosen.provider))return json(res,400,{error:'请选择工作台对话列表中的模型'});
   const selection={provider:chosen.provider,model:chosen.model};
   db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run('modelSelection',JSON.stringify(selection));
   db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run('modelBlock','{}');
   return json(res,200,{ok:true,selection});
  }
  if(url.pathname==='/memory'||url.pathname==='/memory/'){
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'self'"});res.end(await fs.readFile(new URL('./web/index.html',import.meta.url)));return
  }
  if(['/memory/app.js','/memory/style.css','/memory/theme.js','/memory/workbench.css'].includes(url.pathname)){
   res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css','Cache-Control':'no-cache'});res.end(await fs.readFile(new URL('./web/'+url.pathname.split('/').pop(),import.meta.url)));return
  }
  const match=url.pathname.match(/^\/api\/cocloud\/memory\/(status|sources|jobs|evidence|memories|control|search|profile)$/);
  if(!match)return json(res,404,{error:'not found'});
  const body=req.method==='GET'?undefined:await read(req,12000);
  const upstream=await fetch('http://127.0.0.1:3791/'+match[1]+url.search,{method:req.method,headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(180000)});
  res.writeHead(upstream.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(await upstream.text());
 }catch(e){json(res,503,{error:'记忆服务暂不可用',detail:e.name})}
}).listen(3790,'127.0.0.1');
