import * as X from "react";
import {CocloudGithubEntry,cocloudGithubStatus} from "./github-entry.js";
import {CocloudProxyEntry} from "./proxy-entry.js";
import {CocloudWechatEntry,cocloudWechatStatus} from "./wechat-entry.js";
// Shared status stays available while settings are collapsed. Only visible pages poll.
function useCocloudConnectionStatus(url, valid, unavailable, revision) {
 const [state,setState]=X.useState(null),[error,setError]=X.useState(''),[busy,setBusy]=X.useState(false);
 const active=X.useRef(null);
 async function refresh(){
  if(document.hidden||active.current)return;
  const controller=new AbortController();active.current=controller;setBusy(true);
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error(response.status===401||response.status===403?'请重新登录工作台或检查访问权限':unavailable);
   const value=await response.json();if(!valid(value))throw Error('状态响应异常');
   if(active.current===controller){setState(value);setError('');}
  }catch(e){
   if(active.current===controller){setState(null);setError(e.name==='AbortError'?'连接超时，请重新展开重试':e.message||unavailable);}
  }finally{clearTimeout(timeout);if(active.current===controller){active.current=null;setBusy(false);}}
 }
 X.useEffect(()=>{
  refresh();const visible=()=>{if(!document.hidden)refresh();else{const controller=active.current;active.current=null;controller?.abort();setBusy(false);}};
  const timer=setInterval(visible,30000);document.addEventListener('visibilitychange',visible);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);const controller=active.current;active.current=null;controller?.abort();};
 },[url,revision]);
 X.useEffect(()=>{if(state?.login?.state!=='pending')return;const timer=setInterval(refresh,2000);return()=>clearInterval(timer);},[state?.login?.state,url]);
 function commit(value){const controller=active.current;active.current=null;controller?.abort();setBusy(false);setState(value);}
 return {state,setState:commit,error,setError,busy,refresh};
}

function cocloudConnectionIcon(h,kind) {
 const paths={
  proxy:['M4 7h15l-4-4','M20 17H5l4 4','M19 7l-4 4','M5 17l4-4'],
  authorization:['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z','m8 12 3 3 5-6'],
  github:['M9 19c-4 1-4-2-5-2','M15 22v-4a4 4 0 0 0-1-3c3 0 6-2 6-6a5 5 0 0 0-1-3c0-1 0-3-1-3-1 0-3 1-3 1a11 11 0 0 0-6 0S7 3 6 3c-1 0-1 2-1 3a5 5 0 0 0-1 3c0 4 3 6 6 6a4 4 0 0 0-1 3v4'],
  wechat:['M14 14a6 6 0 0 1-6 3H5l-3 2 1-4a7 7 0 1 1 13-5','M15 10a5 5 0 0 1 5 8l1 3-3-1a5 5 0 1 1-3-10Z']
 };
 return h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round',className:'cocloud-connection-icon','aria-hidden':true},...paths[kind].map((d,key)=>h('path',{d,key})));
}

export function CocloudConnectionCenter({authorizationCount=null,canView=false,deviceSettings=null}={}) {
 const h=X.createElement,[open,setOpen]=X.useState(false);
 const count=authorizationCount;
 const wechat=useCocloudConnectionStatus('/wechat/api/status',value=>typeof value.status==='string'&&typeof value.db_available==='boolean','微信服务暂不可用',open);
 const proxy=useCocloudConnectionStatus('/api/cocloud/proxy',value=>typeof value.enabled==='boolean'&&typeof value.canControl==='boolean','代理服务暂不可用',open);
 const github=useCocloudConnectionStatus('/api/cocloud/proxy/github',value=>typeof value.installed==='boolean'&&typeof value.authenticated==='boolean','GitHub 状态暂不可用',open);
 X.useEffect(()=>{if(github.state?.login)proxy.refresh();},[github.state?.login?.state]);
 const git=cocloudGithubStatus(github.state,github.error);
 const login=cocloudWechatStatus(wechat.state,wechat.error);
 const proxyLabel=proxy.error?'状态暂不可用':!proxy.state?'检查中…':proxy.state.enabled?'已启用':'已关闭';
 const summary=(kind,label,detail,status)=>h('span',{className:'cocloud-connection-summary-item','data-connection-kind':kind,'data-state':status,role:'img','aria-label':label+'：'+detail,title:label+'：'+detail},
  cocloudConnectionIcon(h,kind),h('span',{className:'cocloud-connection-label'},label),kind==='authorization'?h('span',{className:'cocloud-connection-count'},count===null?'—':count):null);
 return h('section',{'data-workbench-connections':true,'aria-label':'连接中心',className:'min-w-0 rounded-xl border border-sidebar-border bg-secondary/40 px-3 py-2'},
  h('button',{type:'button','aria-expanded':open,onClick:()=>setOpen(!open),className:'cocloud-connection-trigger w-full text-left text-xs'},
   h('span',{className:'flex min-h-9 items-center gap-2'},
    h('span',{'aria-hidden':true},'⇄'),h('span',{className:'min-w-0 flex-1 font-medium'},'连接中心'),h('span',{className:'text-muted-foreground'},open?'收起':'展开')),
   h('span',{className:'cocloud-connection-summary','aria-live':'polite','aria-busy':wechat.busy||proxy.busy||github.busy},
    summary('proxy','代理',proxy.error||proxyLabel,proxy.error?'offline':!proxy.state?'unknown':proxy.state.enabled?'online':'offline'),
    summary('authorization','授权',count===null?(canView?'读取中…':'不可用'):count+' 台',count===null?'unknown':count>0?'online':'offline'),
    summary('github','GitHub',git.label+' · '+git.detail,git.status),
    summary('wechat','小号',login.label+' · '+login.detail,wechat.error?'offline':!wechat.state?'unknown':wechat.state.status==='已登录'?'online':'offline'))),
  open?h('div',{className:'cocloud-connection-settings'},
   deviceSettings,h(CocloudGithubEntry,{connection:github}),h(CocloudWechatEntry,{connection:wechat}),h(CocloudProxyEntry,{connection:proxy})):null);
}
