import * as X from "react";
export function cocloudWechatStatus(state,error) {
 if(error)return {label:'状态暂不可用',detail:error,tone:'text-amber-500'};
 if(!state)return {label:'检查中…',detail:'正在读取小号状态',tone:'text-muted-foreground'};
 if(state.status==='已登录')return state.db_available
  ?{label:'在线',detail:'已登录 · 消息收发已就绪',tone:'text-emerald-500'}
  :{label:'已登录',detail:'消息读取尚未就绪',tone:'text-amber-500'};
 if(state.status==='等待扫码登录')return {label:'待登录',detail:'打开微信完成扫码或手机确认',tone:'text-amber-500'};
 return {label:'未运行',detail:'微信客户端暂未就绪',tone:'text-muted-foreground'};
}

export function CocloudWechatEntry({connection=null}={}) {
 const h=X.createElement;
 const [open,setOpen]=X.useState(false),[localState,setState]=X.useState(null),[localError,setError]=X.useState(''),[localBusy,setBusy]=X.useState(false);
 const state=connection?connection.state:localState,error=connection?connection.error:localError,busy=connection?connection.busy:localBusy,expanded=connection||open;
 const mounted=X.useRef(false),active=X.useRef(null);
 async function refresh(){
  if(active.current)return;
  const controller=new AbortController();active.current=controller;setBusy(true);
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch('/wechat/api/status',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error(response.status===401?'请重新登录工作台或检查访问权限':'微信服务暂不可用');
   const value=await response.json();if(typeof value.status!=='string'||typeof value.db_available!=='boolean')throw Error('微信状态响应异常');
   if(mounted.current&&active.current===controller){setState(value);setError('');}
  }catch(e){if(mounted.current&&active.current===controller){setState(null);setError(e.name==='AbortError'?'连接超时，请重新展开重试':e.message||'连接失败');}}
  finally{clearTimeout(timeout);if(active.current===controller){active.current=null;if(mounted.current)setBusy(false);}}
 }
 X.useEffect(()=>{
  if(connection)return;
  mounted.current=true;
  if(!open)return()=>{mounted.current=false;};
  setState(null);setError('');refresh();
  const visible=()=>{if(!document.hidden)refresh();};
  const timer=setInterval(visible,30000);document.addEventListener('visibilitychange',visible);
  return()=>{mounted.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);const controller=active.current;active.current=null;controller?.abort();};
 },[open,!!connection]);
 const status=cocloudWechatStatus(state,error);
 return h('section',{'data-workbench-wechat':true,'aria-label':'我的微信小号',className:connection?'min-w-0 text-xs':'min-w-0 rounded-xl border border-sidebar-border bg-secondary/40 px-3 py-2'},
  connection?h('h3',{className:'flex min-h-9 items-center font-medium'},'我的微信小号'):h('button',{type:'button','aria-expanded':open,onClick:()=>setOpen(!open),className:'flex min-h-9 w-full items-center gap-2 text-left text-xs'},
   h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,className:'size-4 shrink-0','aria-hidden':true},h('path',{d:'M20 11a8 8 0 0 1-8 8H8l-5 3 1-6a8 8 0 1 1 16-5Z'})),
   h('span',{className:'min-w-0 flex-1 font-medium'},'我的微信小号'),
   h('span',{className:'text-muted-foreground'},open?'收起':'展开')),
  expanded?h('div',{className:'flex flex-col gap-2 text-xs'},
   h('p',{className:status.tone,role:'status','aria-live':'polite'},busy?'刷新中…':status.label),
   h('p',{className:'break-words text-muted-foreground'},status.detail),
   h('a',{href:'/wechat/',target:'_blank',rel:'noopener',className:'inline-flex min-h-9 items-center text-primary underline underline-offset-2'},'打开微信')):null);
}
