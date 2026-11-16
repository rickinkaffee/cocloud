import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/proxy-entry.js',import.meta.url),'utf8').replace("import * as X from 'react';\n",'').replace('export function CocloudProxyEntry','function CocloudProxyEntry');
let slots=[],index=0,requests=[],enabled=true,canControl=true,fail=false;
const context=vm.createContext({X:{createElement:(tag,props,...children)=>({tag,props:props??{},children}),useState:initial=>{const i=index++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value]}},Date,AbortSignal,fetch:async(url,options)=>{
 requests.push({url,options});
 if(fail)return {ok:false,json:async()=>({error:'请先登录工作台'})};
 if(url.endsWith('/test'))return {ok:true,json:async()=>({checkedAt:Date.now(),results:[{label:'GitHub',ok:true,latencyMs:90},{label:'Google',ok:false,message:'连接失败或超时'}]})};
 if(options.body)enabled=JSON.parse(options.body).enabled;
 return {ok:true,json:async()=>({enabled,startup:enabled,canControl})};
}});
vm.runInContext(source,context);
const render=()=>{index=0;return vm.runInContext('CocloudProxyEntry()',context)};
function nodes(tree){return !tree||typeof tree!=='object'?[]:[tree,...tree.children.flatMap(nodes)]}
const find=(tree,label)=>nodes(tree).find(x=>x.children.includes(label));
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
let tree=render();assert.equal(requests.length,0,'no background requests while closed');
tree.children[0].props.onClick();await flush();tree=render();
assert.equal(requests.length,1);assert.equal(nodes(tree).find(n=>n.props.role==='switch').props['aria-checked'],true);
assert.equal(nodes(tree).find(n=>n.props.role==='switch').tag,'button');
assert.equal(nodes(tree).find(n=>n.props.className==='cocloud-proxy-switch-thumb').props.style.transform,'translateX(16px)');
assert.ok(!JSON.stringify(tree).includes('用于服务器出站访问'));
await find(tree,'连接测速').props.onClick();tree=render();
assert.ok(JSON.stringify(tree).includes('GitHub：90 ms'));assert.ok(JSON.stringify(tree).includes('Google：连接失败或超时'));
assert.ok(!/Medium|Mbps|下载|512/.test(JSON.stringify(tree)));
const switchNode=nodes(tree).find(n=>n.props.role==='switch');switchNode.props.onClick();await flush();tree=render();
assert.equal(enabled,false);assert.equal(find(tree,'连接测速').props.disabled,true);assert.ok(!JSON.stringify(tree).includes('90 ms'),'toggle clears stale speed results');
assert.equal(nodes(tree).find(n=>n.props.role==='switch').props['aria-checked'],false);
assert.equal(nodes(tree).find(n=>n.props.className==='cocloud-proxy-switch-thumb').props.style.transform,'translateX(0)');
assert.equal(requests.at(-1).options.headers['X-Cocloud-Proxy'],'1');
fail=true;await find(tree,'刷新状态').props.onClick();tree=render();assert.equal(nodes(tree).find(n=>n.props.role==='alert').children[0],'请先登录工作台');
fail=false;canControl=false;await find(tree,'刷新状态').props.onClick();tree=render();assert.equal(nodes(tree).find(n=>n.props.role==='switch').props.disabled,true);
console.log('Proxy settings: sliding toggle, Google/GitHub latency only, removed description, lazy status, stale result clearing, auth errors and read-only sessions passed');

assert.equal(readFileSync(new URL('../../../core/apps/web/src/extensions/proxy-entry.js',import.meta.url),'utf8'),readFileSync(new URL('../src/proxy-entry.js',import.meta.url),'utf8'),'core and extension source stay synchronized');
assert.ok(readFileSync(new URL('../../../core/apps/web/src/components/WorkbenchExtensions.tsx',import.meta.url),'utf8').includes('<CocloudProxyEntry />'),'core mounts proxy settings');
assert.ok(readFileSync(new URL('../../../core/apps/web/src/extensions/motion.css',import.meta.url),'utf8').includes('.cocloud-proxy-switch-thumb'),'core includes switch styling');
