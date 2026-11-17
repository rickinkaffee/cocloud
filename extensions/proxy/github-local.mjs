import http from 'node:http';
import {chmod,unlink,mkdir} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {command} from './github.mjs';
export async function createLocalRunner({socket,proxy,run=command}){
 await mkdir(dirname(socket),{recursive:true,mode:0o700});
 await unlink(socket).catch(error=>{if(error.code!=='ENOENT')throw error;});
 const active=new Set();
 const server=http.createServer(async(req,res)=>{
  const send=value=>{if(!res.destroyed)res.write(JSON.stringify(value)+'\n');};
  const controller=new AbortController();active.add(controller);res.on('close',()=>controller.abort());
  try{
   if(req.method!=='POST'||req.url!=='/run')throw Error('Invalid local request');
   let body='';for await(const part of req){body+=part;if(body.length>65536)throw Error('Request too large');}
   const value=JSON.parse(body);
   if(!['git','gh'].includes(value.command)||!Array.isArray(value.args)||!value.args.length||value.args.some(x=>typeof x!=='string'||x.includes('\0'))||!isAbsolute(value.cwd))throw Error('Invalid command');
   res.setHeader('Content-Type','application/x-ndjson');
   const result=await proxy.run(env=>run(value.command,value.args,{cwd:value.cwd,env:{...env,GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'credential.https://github.com.helper',GIT_CONFIG_VALUE_0:'',GIT_CONFIG_KEY_1:'credential.https://github.com.helper',GIT_CONFIG_VALUE_1:'!gh auth git-credential'},signal:controller.signal,timeout:900000,onOutput:(data,stream)=>send({data,stream})}));
   send({exitCode:result.code});
  }catch(error){send({error:error.status===409?error.message:'GitHub 操作未完成，请检查代理和命令配置',exitCode:1});}
  finally{active.delete(controller);res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});await chmod(socket,0o600);
 return {server,async close(){for(const controller of active)controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
