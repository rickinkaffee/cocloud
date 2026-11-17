import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
export const githubConfigDir=()=>process.env.GH_CONFIG_DIR||join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'gh');
export function command(command,args,{env={},cwd,signal,timeout=20000,onOutput=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,env:{...process.env,GH_DEBUG:'',GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0',GH_CONFIG_DIR:githubConfigDir(),...env},stdio:['pipe','pipe','pipe'],detached:true});
  let output='',stdout='',finished=false,killer;
  const terminate=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}killer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1000);killer.unref();};
  const timer=setTimeout(terminate,timeout);timer.unref();
  const abort=()=>terminate();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)terminate();
  child.stdin.end();
  for(const [stream,source] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',chunk=>{
   onOutput(chunk.toString(),source);output=(output+chunk).slice(-32768);if(source==='stdout')stdout=(stdout+chunk).slice(-32768);
  });
  const cleanup=()=>{finished=true;clearTimeout(timer);clearTimeout(killer);signal?.removeEventListener('abort',abort);};
  child.on('error',error=>{if(!finished){cleanup();reject(error);}});
  child.on('close',code=>{if(!finished){cleanup();resolve({code:code??1,output,stdout});}});
 });
}
export function createGitHub({proxy,run=command,now=Date.now,loginTimeout=900000,configDir=githubConfigDir()}={}){
 let report={connected:null,checkedAt:null,account:null,message:''},fingerprint=null,pending=null,closing=false;
 const gh=(args,options={})=>run('gh',args,{...options,env:{...options.env,GH_CONFIG_DIR:configDir}});
 async function local(){
  try{
   const value=await gh(['auth','token','--hostname','github.com']);
   const token=value.code===0?(value.stdout??value.output).trim():'';
   const next=token?createHash('sha256').update(token).digest('hex'):null;
   if(next!==fingerprint){fingerprint=next;report={connected:null,checkedAt:null,account:null,message:''};}
   return {installed:true,authenticated:!!token};
  }catch(error){if(error.code==='ENOENT')return {installed:false,authenticated:false};throw error;}
 }
 async function status(canControl=false){
  const state=await local();
  return {...state,...report,canControl,temporaryProxy:proxy.temporary,
   busy:proxy.busy,login:pending?{state:pending.state,expiresAt:pending.expiresAt,
    message:pending.message,...(canControl&&pending.state==='pending'?{code:pending.code,verificationUrl:'https://github.com/login/device'}:{})}:null};
 }
 async function verify(env,signal){
  const value=await gh(['api','--hostname','github.com','user','--jq','.login'],{env,signal});
  const account=value.code===0&&/^[a-z\d](?:[a-z\d-]{0,38})$/i.test((value.stdout??value.output).trim())?(value.stdout??value.output).trim():null;
  report={connected:!!account,checkedAt:now(),account,message:account?'连接正常':/401|bad credentials|authentication failed/i.test(value.output)?'GitHub 登录已失效，请重新登录':'无法连接 GitHub，请稍后重试'};
  return !!account;
 }
 return {
  status,
  async check(){if(closing)throw Error('服务正在关闭');await local();await proxy.run(env=>verify(env));return status(true);},
  async login(){
   if(closing)throw Error('服务正在关闭');
   if(pending?.state==='pending'||proxy.busy)throw Object.assign(Error('GitHub 或代理正在操作，请稍后重试'),{status:409});
   if(process.env.GH_TOKEN||process.env.GITHUB_TOKEN)throw Object.assign(Error('当前使用环境变量登录，请先由管理员调整认证配置'),{status:409});
   const config=configDir;
   const current={state:'pending',code:null,expiresAt:now()+loginTimeout,message:'正在准备网页登录…',controller:new AbortController()};pending=current;
   let loginOutput='';let ready;const started=new Promise(resolve=>{ready=resolve;});
   current.done=proxy.run(async env=>{
    await mkdir(config,{recursive:true,mode:0o700});await chmod(config,0o700);
    current.controller.signal.throwIfAborted();
    const value=await gh(['auth','login','--hostname','github.com','--git-protocol','https','--web','--insecure-storage'],{
     env:{...env,BROWSER:'true',GH_BROWSER:'true'},signal:current.controller.signal,timeout:loginTimeout,
     onOutput(chunk){loginOutput=(loginOutput+chunk).slice(-2048);const code=loginOutput.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);if(code){current.code=code[0];current.message='请在 GitHub 输入验证码完成授权';ready();}},
    });
    if(current.controller.signal.aborted)throw Error('cancelled');
    if(value.code!==0)throw Error('login_failed');
    // gh persists its own private credential file. Never return or log its output.
    try{await chmod(join(config,'hosts.yml'),0o600);}catch(error){if(error.code!=='ENOENT')throw error;}
    await local();
    if(!await verify(env,current.controller.signal))throw Error('verification_failed');
   }).then(()=>{current.state='success';current.message='GitHub 登录成功';current.code=null;}).catch(()=>{current.state=current.controller.signal.aborted?'cancelled':now()>=current.expiresAt?'expired':'failed';current.message=current.state==='cancelled'?'已取消登录':current.state==='expired'?'登录已超时，请重试':'登录未完成，请重试';current.code=null;})
    .finally(()=>{if(current.state==='pending'){current.state='failed';current.message='代理清理失败，请检查代理状态';}ready();});
   // Return the code promptly; preparation failure and client disconnect never skip cleanup.
   await Promise.race([started,new Promise(resolve=>{const t=setTimeout(resolve,1500);t.unref();})]);
   return status(true);
  },
  async cancel(){if(pending?.state==='pending'){pending.controller.abort();await pending.done;}return status(true);},
  async close(){closing=true;if(pending?.state==='pending'){pending.controller.abort();await pending.done;}},
 };
}
