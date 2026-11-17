import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createConnection} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
export async function waitForProxy(address,timeout=10000){
 const url=new URL(address),port=Number(url.port||(['socks5:','socks5h:'].includes(url.protocol)?1080:80));
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  const ready=await new Promise(resolve=>{
   const socket=createConnection({host:url.hostname.replace(/^\[|\]$/g,''),port});
   const finish=value=>{socket.destroy();resolve(value);};
   socket.setTimeout(Math.min(300,Math.max(1,deadline-Date.now())),()=>finish(false));
   socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));
  });
  if(ready)return;
  await pause(Math.min(100,Math.max(1,deadline-Date.now())));
 }
 throw Error('Proxy listener did not become ready');
}
const exec=promisify(execFile);
export function createTemporaryProxy({unit,proxy,stateFile,ready=()=>waitForProxy(proxy),control=async action=>{
 try{return (await exec('systemctl',[action,unit],{timeout:20000})).stdout.trim();}
 catch(error){if(action==='is-active'&&['inactive','failed'].includes(error.stdout?.trim()))return error.stdout.trim();throw error;}
}}){
 let busy=false,temporary=false;
 const save=async()=>{await mkdir(dirname(stateFile),{recursive:true,mode:0o700});await writeFile(stateFile+'.next',JSON.stringify({version:1,unit,owned:true}),{mode:0o600});await rename(stateFile+'.next',stateFile);};
 const clear=()=>unlink(stateFile).catch(error=>{if(error.code!=='ENOENT')throw error;});
 async function recover(){
  let value;try{value=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(value.version!==1||value.unit!==unit||value.owned!==true)throw Error('Invalid proxy recovery journal');
  await control('stop');await clear();temporary=false;
 }
 return {
  get busy(){return busy;},get temporary(){return temporary;},recover,
  async exclusive(run){
   if(busy)throw Object.assign(Error('GitHub 或代理正在操作，请稍后重试'),{status:409});
   busy=true;try{if(temporary)await recover();return await run();}finally{busy=false;}
  },
  async run(run){
   return this.exclusive(async()=>{
    const state=await control('is-active');
    if(!['active','inactive','failed'].includes(state))throw Error('Proxy state unavailable');
    const owned=state!=='active';
    // Record ownership before starting. ExecStopPost can restore after SIGKILL.
    if(owned){await save();temporary=true;}
    try{
     if(owned)await control('start');
     await ready();
     return await run({HTTPS_PROXY:proxy,HTTP_PROXY:proxy,ALL_PROXY:proxy,
      https_proxy:proxy,http_proxy:proxy,all_proxy:proxy,NO_PROXY:'127.0.0.1,localhost,::1',no_proxy:'127.0.0.1,localhost,::1'});
    }finally{
     if(owned){await control('stop');await clear();temporary=false;}
    }
   });
  },
 };
}
