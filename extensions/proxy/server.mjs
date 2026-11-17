import http from 'node:http';
import {authenticateWorkbench as authenticate} from '../project-import/workbench-auth.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {createTemporaryProxy} from './temporary-proxy.mjs';
import {createGitHub} from './github.mjs';
import {createLocalRunner} from './github-local.mjs';
import {socketPath} from './github-run.mjs';
const exec = promisify(execFile);
const UNIT = process.env.PROXY_SERVICE || 'workbench-outbound-proxy.service';
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*\.service$/.test(UNIT)) throw Error('Invalid PROXY_SERVICE');
export const PROXY = process.env.PROXY_URL || 'http://127.0.0.1:17890';
const proxyUrl = new URL(PROXY);
if (!['http:','socks5:','socks5h:'].includes(proxyUrl.protocol) || !['127.0.0.1','localhost','[::1]'].includes(proxyUrl.hostname) || proxyUrl.username || proxyUrl.password) throw Error('PROXY_URL must be a credential-free loopback proxy');
export async function status() {
  const check = async command => {
    try { return (await exec('systemctl', [command, UNIT], {timeout:5000})).stdout.trim(); }
    catch(e) { return e.stdout?.trim() || 'unknown'; }
  };
  const [active, startup] = await Promise.all([check('is-active'),check('is-enabled')]);
  return {enabled:active==='active', active, startup:startup==='enabled', proxy:PROXY};
}
export async function setEnabled(enabled) {
  await exec('systemctl',[enabled?'enable':'disable','--now',UNIT],{timeout:20000});
  const result = await status();
  if (result.enabled !== enabled || result.startup !== enabled) throw Error('state_mismatch');
  return result;
}
// Fixed destinations only: neither the URL nor curl arguments come from clients.
export async function probe(label,url) {
  const started = Date.now();
  try {
    const {stdout} = await exec('curl',['--proxy',PROXY,'--noproxy','','--silent','--show-error',
      '--connect-timeout','5','--max-time','12','--output','/dev/null',
      '--write-out','%{http_code} %{time_starttransfer} %{time_total}',url],
      {timeout:14000,maxBuffer:8192});
    const [code,first,total] = stdout.trim().split(/\s+/).map(Number);
    const ok = code>=200 && code<300;
    return {label,ok,httpStatus:code,latencyMs:Math.round(first*1000),durationMs:Math.round(total*1000),
      message:ok?'成功':code===403?'网站拒绝访问或要求验证':`HTTP ${code}`};
  } catch {
    return {label,ok:false,httpStatus:null,durationMs:Date.now()-started,message:'连接失败或超时'};
  }
}
export async function speedTest(runProbe=probe) {
  const results = await Promise.all([
    runProbe('GitHub','https://api.github.com/zen'),
    runProbe('Google','https://www.gstatic.com/generate_204'),
  ]);
  return {checkedAt:Date.now(),results};
}
export function createServer({auth=authenticate,read=status,toggle=setEnabled,test=speedTest,
  origin=process.env.WORKBENCH_ORIGIN,github=null,proxy=null}={}) {
  if (!origin || new URL(origin).origin !== origin || new URL(origin).protocol !== 'https:') throw Error('WORKBENCH_ORIGIN must be a canonical HTTPS origin');
  let busy=false, lastTest=0, cached;
  return http.createServer(async(req,res)=>{
    const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      const githubRoute=path.match(/^\/api\/cocloud\/proxy\/github(?:\/(check|login|cancel))?$/);
      if(!githubRoute&&path!=='/api/cocloud/proxy'&&path!=='/api/cocloud/proxy/test')return reply(404,{error:'接口不存在'});
      if(req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'来源不允许'});
      if(req.headers.origin && req.headers.origin!==origin)return reply(403,{error:'来源不允许'});
      const session=await auth(req.headers);
      if(session.cookies?.length)res.setHeader('Set-Cookie',session.cookies);
      if(!session.authenticated)return reply(401,{error:'请先登录工作台'});
      const scopes=session.permissions??session.scopes??[];
      if(!scopes.includes('diagnostics:read'))return reply(403,{error:'缺少诊断读取权限'});
      const canGitHub=scopes.includes('settings:write')&&scopes.includes('environment:maintain');
      if(githubRoute){
       if(!github)return reply(503,{error:'GitHub 服务未配置'});
       if(req.method==='GET'&&!githubRoute[1])return reply(200,await github.status(canGitHub));
       if(req.method!=='POST'||!githubRoute[1])return reply(405,{error:'请求方法不允许'});
       if(req.headers.origin!==origin||req.headers['x-cocloud-proxy']!=='1'||!canGitHub)return reply(403,{error:'需要维护及设置权限，并从当前工作台操作'});
       if(req.headers['content-length']&&Number(req.headers['content-length'])>1024)return reply(413,{error:'请求过大'});
       let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024)return reply(413,{error:'请求过大'});}
       return reply(200,await github[githubRoute[1]]());
      }
      if(req.method==='GET'&&path==='/api/cocloud/proxy')return reply(200,{...await read(),temporary:proxy?.temporary??false,canControl:scopes.includes('settings:write')&&!proxy?.busy});
      if(req.method!=='POST')return reply(405,{error:'请求方法不允许'});
      if(req.headers['x-cocloud-proxy']!=='1')return reply(403,{error:'缺少请求标识'});
      if(!scopes.includes('settings:write'))return reply(403,{error:'缺少设置修改权限'});
      if(busy||proxy?.busy)return reply(409,{error:'代理正在操作或测速，请稍后再试'});
      let body='',tooLarge=false;
      for await(const chunk of req){body+=chunk;if(body.length>1024){tooLarge=true;break;}}
      if(tooLarge)return reply(413,{error:'请求过大'});
      let value;try{value=JSON.parse(body||'{}')}catch{return reply(400,{error:'请求格式错误'})}
      if(path==='/api/cocloud/proxy'&&typeof value.enabled!=='boolean')return reply(400,{error:'启用状态必须是布尔值'});
      busy=true;
      try {
        if(path==='/api/cocloud/proxy')return reply(200,{...await (proxy?proxy.exclusive(()=>toggle(value.enabled)):toggle(value.enabled)),canControl:true});
        if(!(await read()).enabled)return reply(409,{error:'请先启用服务器代理'});
        if(cached&&Date.now()-lastTest<15000)return reply(200,cached);
        cached=await (proxy?proxy.exclusive(()=>test()):test());lastTest=Date.now();return reply(200,cached);
      }finally{busy=false}
    }catch(error){return reply(error.status||503,{error:error.status===409?error.message:'服务操作失败，请稍后重试'})}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const proxy=createTemporaryProxy({unit:UNIT,proxy:PROXY,stateFile:join(process.env.PROXY_STATE_DIR||'/var/lib/open-workbench-proxy','temporary.json')});
  await proxy.recover();
  if(process.argv.includes('--recover'))process.exit(0);
  const github=createGitHub({proxy});
  const local=await createLocalRunner({socket:socketPath(),proxy});
  const server=createServer({github,proxy});server.listen(Number(process.env.PROXY_CONTROL_PORT || 3794),'127.0.0.1');
  let closing=false;
  async function close(){if(closing)return;closing=true;server.close();server.closeIdleConnections();await Promise.allSettled([github.close(),local.close()]);}
  process.on('SIGTERM',close);process.on('SIGINT',close);
}
