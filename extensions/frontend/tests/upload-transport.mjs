import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createImportServer} from '../../project-import/project-import-server.mjs';
const out=process.argv[2];
const context=vm.createContext({AbortController,AbortSignal,setTimeout,clearTimeout});
vm.runInContext(readFileSync(out+'/upload-transport-compiled.js','utf8'),context);
const {uploadFolder}=context.CocloudUploadTransport;
const makeError=code=>Object.assign(Error(code),{code});
const timing={read:40,chunk:40,status:40,prepare:1000,commit:1000,retryDelay:0};
const options=files=>({name:'upload-test',files,chunkBytes:8*1024**2,signal:new AbortController().signal,onProgress:()=>{}});
const file=(path,data)=>({path,file:new Blob([data])});
let cancelled=false;
const baseRequest=async(path,init)=>{
 if(path==='')return {id:'session'};
 if(init?.method==='DELETE'){cancelled=true;return {};}
 if(path.endsWith('/commit'))return {path:'/test'};
 if(init?.method==='PUT')return {offset:init.body.byteLength};
 return {offset:0,exists:false};
};
// Reproduce a request that never resolves after four completed files. It must
// terminate with the actual filename rather than leave the last progress forever.
const hungPath='启动与诊断/blocked.bin';
const files=[...Array.from({length:4},(_,i)=>file(`${i===3?'启动与诊断/README.md':i+'.txt'}`,'ok')),file(hungPath,'blocked')];
let progress=[],hungAttempts=0;
const started=Date.now();
await assert.rejects(uploadFolder({...options(files),onProgress:p=>progress.push(p)},async(path,init)=>{
 if(init?.method==='PUT'&&path.includes('/files/4?')){hungAttempts++;return new Promise(()=>{});}
 return baseRequest(path,init);
},makeError,timing),error=>error.code.includes(hungPath));
assert.equal(hungAttempts,5);assert.equal(cancelled,false);assert.ok(Date.now()-started<2000);
assert.ok(progress.some(p=>p.files===4));assert.ok(progress.some(p=>p.currentPath===hungPath));
// Retry an identical folder: skip accepted files and continue partial chunks.
let resumedPuts=[];
await uploadFolder(options([file('done.txt','hello'),file('partial.txt','world'),file('empty.txt','')]),async(path,init)=>{
 if(path==='')return {id:'session',resumed:true,offsets:[5,2,0],exists:[true,true,true]};
 if(init?.method==='PUT'){resumedPuts.push(path);return {offset:5};}
 return baseRequest(path,init);
},makeError,timing);
assert.deepEqual(resumedPuts,['/session/files/1?offset=2']);
// Temporary login-service outage gets delayed retries without losing progress.
let unavailable=0;
await uploadFolder(options([file('service-restart.txt','hello')]),async(path,init)=>{
 if(init?.method==='PUT'&&unavailable++<2)throw makeError('import_unavailable');
 return baseRequest(path,init);
},makeError,timing);
assert.equal(unavailable,3);
// Inaccessible local File reads must time out before any PUT occurs.
let puts=0;
await assert.rejects(uploadFolder(options([{path:'cloud-placeholder.dat',file:{size:5,slice:()=>({arrayBuffer:()=>new Promise(()=>{})})}}]),async(path,init)=>{if(init?.method==='PUT')puts++;return baseRequest(path,init);},makeError,timing),error=>error.code.includes('cloud-placeholder.dat'));
assert.equal(puts,0);
// A lost successful response is recovered with only that file's offset; no
// full-session enumeration and no duplicate PUT are allowed.
let actualPuts=0,statusCalls=0;
await uploadFolder(options([file('lost-response.txt','hello')]),async(path,init)=>{
 if(init?.method==='PUT'){actualPuts++;throw new TypeError('lost response');}
 if(path==='/session/files/0'){statusCalls++;return {offset:5,exists:true};}
 return baseRequest(path,init);
},makeError,timing);
assert.equal(actualPuts,1);assert.equal(statusCalls,1);
// An empty file that was never created must be retried even though its offset is zero.
let emptyPuts=0;
await uploadFolder(options([file('empty.txt','')]),async(path,init)=>{
 if(init?.method==='PUT'){emptyPuts++;if(emptyPuts===1)throw new TypeError('lost request');return {offset:0};}
 return baseRequest(path,init);
},makeError,timing);
assert.equal(emptyPuts,2);
// User cancellation while a request hangs remains bounded and removes staging.
const controller=new AbortController();
const aborted=uploadFolder({...options([file('cancel.txt','x')]),signal:controller.signal},async(path,init)=>init?.method==='PUT'?new Promise(()=>{}):baseRequest(path,init),makeError,timing);
setTimeout(()=>controller.abort(),10);await assert.rejects(aborted,error=>error.name==='AbortError');
// Exercise the maintained compiled uploader through real HTTP with the reported
// number of files and 84 MiB, then verify exact stored bytes including zero files.
const root=await mkdtemp(join(tmpdir(),'cocloud-upload-transport-'));
await mkdir(join(root,'existing','启动与诊断'),{recursive:true});
await writeFile(join(root,'existing','启动与诊断/README.md'),'old');
await writeFile(join(root,'existing','server-only.txt'),'keep');
const server=await createImportServer({root,resolveProject:async()=>({workspaceRoot:join(root,'existing')}),authenticate:async()=>({authenticated:true,permissions:['filesystem:write','orchestration:operate','filesystem:read','orchestration:read']})});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}/api/cocloud/imports`;
try{
 const count=52905,total=Math.round(468.93*1024**2),unit=Math.floor(total/(count-1)),bytes=new Uint8Array(unit).fill(0x5a);
 const transferFiles=Array.from({length:count},(_,i)=>({path:`启动与诊断/${i===3?'README.md':i+'.bin'}`,file:i===0?new Blob([]):new Blob([i===count-1?new Uint8Array(total-unit*(count-2)).fill(0x5a):bytes])}));
 const request=async(path,init={})=>{
  const response=await fetch(base+path,{...init,headers:{'X-Cocloud-Import':'1',...init.headers}});
  const result=await response.json();if(!response.ok)throw makeError(result.error);return result;
 };
 const preview=await request('/sync/existing/manifest?purpose=upload');
 const began=Date.now();let completed=0,committing=false;
 const result=await uploadFolder({...options(transferFiles),target:{projectId:'existing',baseVersion:preview.version},destination:{placement:'root',conflict:'overwrite'},onProgress:p=>{completed=Math.max(completed,p.files);committing ||= p.phase==='committing';}},request,makeError);
 assert.equal(completed,count);assert.ok(committing);assert.equal(result.fileCount,count);assert.equal(result.totalBytes,total);
 assert.equal(await readFile(join(result.path,'server-only.txt'),'utf8'),'keep');
 assert.equal((await readFile(join(result.path,'启动与诊断/0.bin'))).length,0);
 assert.deepEqual(new Uint8Array(await readFile(join(result.path,'启动与诊断/README.md'))),bytes);
 console.log(`Upload transport: real HTTP ${count} files / ${(total/1024**2).toFixed(2)} MiB with overwrite committed in ${Date.now()-began}ms; hung fifth request, unreadable local file, bounded retries, targeted offset recovery, zero-byte retry and cancel passed`);
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
