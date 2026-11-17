// Local-only command runner: the bridge owns temporary proxy cleanup, including disconnects.
import http from 'node:http';
import {pathToFileURL} from 'node:url';
export const socketPath=()=>process.env.GITHUB_RUN_SOCKET||'/run/open-workbench-proxy/github.sock';
export function runGitHub(args,{socket=socketPath(),cwd=process.cwd(),stdout=process.stdout,stderr=process.stderr}={}){
 const [command,...argv]=args;
 if(!['git','gh'].includes(command)||!argv.length)throw Error('Usage: node github-run.mjs git|gh <arguments>');
 return new Promise((resolve,reject)=>{
  const request=http.request({socketPath:socket,path:'/run',method:'POST',headers:{'Content-Type':'application/json'}},response=>{
   let buffer='';response.setEncoding('utf8');
   response.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;const row=JSON.parse(line);if(row.stream==='stdout')stdout.write(row.data);if(row.stream==='stderr')stderr.write(row.data);if(row.exitCode!==undefined)resolve(row.exitCode);if(row.error)reject(Error(row.error));}});
   response.on('end',()=>resolve(1));response.on('error',reject);
  });
  const cancel=()=>request.destroy(Error('Cancelled'));process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  request.on('close',()=>{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);});
  request.on('error',reject);request.end(JSON.stringify({command,args:argv,cwd}));
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exitCode=await runGitHub(process.argv.slice(2));}catch{console.error('GitHub 操作失败：请检查代理控制服务或操作是否正在进行');process.exitCode=1;}
}
