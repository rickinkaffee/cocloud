import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const out=process.argv[2]||'output';mkdirSync(out,{recursive:true});
const adapter={name:'test-react',setup(b){
 b.onResolve({filter:/^react(-dom)?$/},a=>({path:a.path,namespace:'host'}));
 b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react'?'export const useEffect=X.useEffect,useEffectEvent=X.useEffectEvent;':'export const flushSync=Fv.flushSync;',loader:'js'}));
}};
const compiled=await build({entryPoints:['src/hooks/useWorkbenchSidebarSwipe.ts'],bundle:true,write:false,format:'iife',globalName:'WorkbenchGesture',target:'es2022',plugins:[adapter],legalComments:'inline'});
writeFileSync(out+'/Rb-compiled.js',compiled.outputFiles[0].text+'\nfunction Rb(...args){return WorkbenchGesture.useWorkbenchSidebarSwipe(...args)}');
const test=spawnSync(process.execPath,['tests/gestures.mjs',out],{stdio:'inherit'});if(test.status!==0)process.exit(test.status||1);

const proxyTest=spawnSync(process.execPath,['tests/proxy-entry.mjs'],{stdio:'inherit'});if(proxyTest.status!==0)process.exit(proxyTest.status||1);
