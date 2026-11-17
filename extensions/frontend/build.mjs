import {build} from 'esbuild';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const parity=spawnSync(process.execPath,['../../scripts/check-feature-sources.mjs'],{stdio:'inherit'});if(parity.status!==0)process.exit(parity.status||1);
const out=process.argv[2]||'output';mkdirSync(out,{recursive:true});
const adapter={name:'test-react',setup(b){
 b.onResolve({filter:/^react(-dom)?$/},a=>({path:a.path,namespace:'host'}));
 b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react'?'export const useEffect=X.useEffect,useEffectEvent=X.useEffectEvent;':'export const flushSync=Fv.flushSync;',loader:'js'}));
}};
const compiled=await build({entryPoints:['src/hooks/useWorkbenchSidebarSwipe.ts'],bundle:true,write:false,format:'iife',globalName:'WorkbenchGesture',target:'es2022',plugins:[adapter],legalComments:'inline'});
writeFileSync(out+'/Rb-compiled.js',compiled.outputFiles[0].text+'\nfunction Rb(...args){return WorkbenchGesture.useWorkbenchSidebarSwipe(...args)}');
const test=spawnSync(process.execPath,['tests/gestures.mjs',out],{stdio:'inherit'});if(test.status!==0)process.exit(test.status||1);

const githubTest=spawnSync(process.execPath,['tests/github-entry.mjs'],{stdio:'inherit'});if(githubTest.status!==0)process.exit(githubTest.status||1);
const proxyTest=spawnSync(process.execPath,['tests/proxy-entry.mjs'],{stdio:'inherit'});if(proxyTest.status!==0)process.exit(proxyTest.status||1);

for (const [name,globalName] of [['folder-upload','CocloudFolderUpload'],['upload-transport','CocloudUploadTransport'],['file-properties','CocloudFileProperties']]) {
 const result=await build({entryPoints:['src/'+name+'.ts'],bundle:true,write:false,format:'iife',globalName,target:'es2022'});
 writeFileSync(out+'/'+name+'-compiled.js',result.outputFiles[0].text);
 const check=spawnSync(process.execPath,['tests/'+name+'.mjs',out],{stdio:'inherit'});
 if(check.status!==0)process.exit(check.status||1);
}

const downloads=spawnSync(process.execPath,['tests/direct-attachment.mjs'],{stdio:'inherit'});if(downloads.status!==0)process.exit(downloads.status||1);
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(dir+'/'+entry.name):[dir+'/'+entry.name]);
const sources=Object.fromEntries([...files('src'),...files('tests'),'build.mjs','package.json','package-lock.json'].map(path=>[path,hash(path)]));
const outputs=Object.fromEntries(readdirSync(out).filter(name=>name.endsWith('.js')).map(name=>[name,hash(out+'/'+name)]));
writeFileSync(out+'/receipt.json',JSON.stringify({sources,outputs,tests:'gesture, proxy, folder choices, bounded resumable HTTP upload, properties, native attachment'},null,2)+'\n');
