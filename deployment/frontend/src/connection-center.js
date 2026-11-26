// Shared status stays available while settings are collapsed. Only visible pages poll.
function cocloudUseConnectionStatus(url, valid, unavailable, open) {
 const [state,setState]=X.useState(null),[error,setError]=X.useState(''),[busy,setBusy]=X.useState(false);
 const active=X.useRef(null),checked=X.useRef(0);
 async function refresh(){
  if(document.hidden||active.current)return;
  const controller=new AbortController();active.current=controller;setBusy(true);
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error(response.status===401||response.status===403?'请重新登录工作台或检查访问权限':unavailable);
   const value=await response.json();if(!valid(value))throw Error('状态响应异常');
   if(active.current===controller){checked.current=Date.now();setState(value);setError('');}
  }catch(e){
   if(active.current===controller){checked.current=Date.now();setState(null);setError(e.name==='AbortError'?'连接超时，请重试':e.message||unavailable);}
  }finally{clearTimeout(timeout);if(active.current===controller){active.current=null;setBusy(false);}}
 }
 X.useEffect(()=>{
  refresh();return()=>{const controller=active.current;active.current=null;controller?.abort();};
 },[url]);
 X.useEffect(()=>{
  const period=open?30000:120000;
  const visible=()=>{if(document.hidden){const controller=active.current;active.current=null;controller?.abort();setBusy(false);}else if(Date.now()-checked.current>=period)refresh();};
  if(open)visible();
  const timer=setInterval(refresh,period);document.addEventListener('visibilitychange',visible);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[url,open]);
 X.useEffect(()=>{if(state?.login?.state!=='pending')return;const timer=setInterval(refresh,2000);return()=>clearInterval(timer);},[state?.login?.state,url]);
 function commit(value){const controller=active.current;active.current=null;controller?.abort();checked.current=Date.now();setBusy(false);setState(value);}
 return {state,setState:commit,error,setError,busy,refresh};
}

function cocloudConnectionIcon(h,kind) {
 const paths={
  proxy:['M4 7h15l-4-4','M20 17H5l4 4','M19 7l-4 4','M5 17l4-4'],
  authorization:['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z','m8 12 3 3 5-6'],
  github:['M9 19c-4 1-4-2-5-2','M15 22v-4a4 4 0 0 0-1-3c3 0 6-2 6-6a5 5 0 0 0-1-3c0-1 0-3-1-3-1 0-3 1-3 1a11 11 0 0 0-6 0S7 3 6 3c-1 0-1 2-1 3a5 5 0 0 0-1 3c0 4 3 6 6 6a4 4 0 0 0-1 3v4'],
  wechat:['M14 14a6 6 0 0 1-6 3H5l-3 2 1-4a7 7 0 1 1 13-5','M15 10a5 5 0 0 1 5 8l1 3-3-1a5 5 0 1 1-3-10Z'],
  email:['M3 5h18v14H3z','m3 6 9 7 9-7'],
  enterpriseWechat:['M14 14a6 6 0 0 1-6 3H5l-3 2 1-4a7 7 0 1 1 13-5','M15 10a5 5 0 0 1 5 8l1 3-3-1a5 5 0 1 1-3-10Z','M12 3v4','M10 5h4'],
 };
 return h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round',className:'cocloud-connection-icon','aria-hidden':true},...paths[kind].map((d,key)=>h('path',{d,key})));
}

function CocloudConnectionCenter() {
 const h=X.createElement,[open,setOpen]=X.useState(false),[selected,setSelected]=X.useState(null),details=X.useRef(null);
 X.useEffect(()=>{if(open&&selected)details.current?.focus();},[open,selected]);
 const environment=hf(),canView=pl(environment,Kr),access=_l(canView&&environment?cz.accessChanges({environmentId:environment,input:null}):null);
 // Use the same live access snapshot and visibility policy as device settings.
 const snapshot=access.data?.type==='snapshot'?access.data.payload:null;
 const count=snapshot?snapshot.clientSessions.filter(cocloudVisibleClient).length:null;
 const canOpenWecom=pl(environment,'environment:maintain');
 const wecom=cocloudUseConnectionStatus('/wecom/api/status',value=>['online','offline','error'].includes(value?.state)&&typeof value.detail==='string','企业微信服务暂不可用',open);
 const wecomState=wecom.error||wecom.state?.state==='error'?'abnormal':wecom.state?.state??'unknown';
 const wecomLabel={online:'在线',offline:'未连接',abnormal:'异常',unknown:'检查中…'}[wecomState];
 const wecomDetail=wecom.error||wecom.state?.detail;
 const wechat=cocloudUseConnectionStatus('/wechat/api/status',value=>typeof value.status==='string'&&typeof value.db_available==='boolean','微信服务暂不可用',open);
 const proxy=cocloudUseConnectionStatus('/api/cocloud/proxy',value=>typeof value.enabled==='boolean'&&typeof value.canControl==='boolean','代理服务暂不可用',open);
 const github=cocloudUseConnectionStatus('/api/cocloud/proxy/github',value=>typeof value.installed==='boolean'&&typeof value.authenticated==='boolean','GitHub 状态暂不可用',open);
 X.useEffect(()=>{if(github.state?.login)proxy.refresh();},[github.state?.login?.state]);
 const git=cocloudGithubStatus(github.state,github.error);
 const login=cocloudWechatStatus(wechat.state,wechat.error);
 const proxyLabel=proxy.error?'状态暂不可用':!proxy.state?'检查中…':proxy.state.enabled?'已启用':'已关闭';
 const summary=(kind,label,detail,status,short)=>h('button',{type:'button',className:'cocloud-connection-summary-item','data-connection-kind':kind,'data-state':status,'aria-expanded':open&&(!selected||selected===kind),'aria-label':label+'：'+detail,title:label+'：'+detail,onClick:()=>{setSelected(kind);setOpen(true);}},
  kind==='enterpriseWechat'?h('span',{className:'cocloud-connection-glyph'},cocloudConnectionIcon(h,kind)):cocloudConnectionIcon(h,kind),open&&h('span',null,h('span',{className:'cocloud-connection-label'},label),h('small',null,short)));
 const entry=(kind,component,connection)=>!selected||selected===kind?[h(component,{key:kind,...(connection?{connection}:{})}),connection?.error?h('button',{key:kind+'-retry',type:'button',className:'min-h-9 px-2 text-xs',disabled:connection.busy,onClick:connection.refresh},'重试'+({github:' GitHub',wechat:'微信',proxy:'代理'}[kind])):null]:null;
 const passive=(kind,label,detail,state)=>h('span',{role:'img',className:'cocloud-connection-summary-item','data-connection-kind':kind,'data-state':state,'aria-label':label+'：'+detail,title:label+'：'+detail},
  h('span',{className:'cocloud-connection-glyph'},cocloudConnectionIcon(h,kind)),open&&h('span',null,label));
 return h('section',{'data-workbench-connections':true,'aria-label':'连接中心',className:'min-w-0 rounded-xl border border-sidebar-border bg-secondary/40 px-3 py-2'},
  h('button',{type:'button','aria-expanded':open,'aria-label':open?'收起连接中心':'展开连接中心',onClick:()=>{setSelected(null);setOpen(!open);},className:'cocloud-connection-trigger flex min-h-9 w-full items-center justify-between text-left text-xs'},
   h('span',{'aria-hidden':true},'⇄'),open&&h('span',null,'连接中心'),h('span',{'aria-hidden':true},open?'⌃':'⌄')),
  h('div',{className:'cocloud-connection-summary','aria-live':'polite','aria-busy':wechat.busy||wecom.busy||proxy.busy||github.busy},
    summary('proxy','代理',proxy.error||proxyLabel,proxy.error?'offline':!proxy.state?'unknown':proxy.state.enabled?'online':'idle',proxy.error?'异常':!proxy.state?'检查中':proxy.state.enabled?'已开':'已关'),
    summary('authorization','授权',count===null?(canView?'读取中…':'不可用'):count+' 台',count===null?'unknown':count>0?'online':'idle',count===null?'—':count+' 台'),
    summary('github','GitHub',git.label+' · '+git.detail,github.error||git.label==='连接失败'?'offline':git.status==='offline'?'idle':git.status,github.error?'异常':git.label),
    summary('wechat','小号',login.label+' · '+login.detail,wechat.error?'offline':!wechat.state?'unknown':wechat.state.status==='已登录'&&wechat.state.db_available?'online':'idle',wechat.error?'异常':login.label),
    passive('email','邮件','未连接','idle'),
    summary('enterpriseWechat','企业微信',[wecomLabel,wecomDetail].filter(Boolean).join(' · '),wecomState,wecomLabel),
    h(CocloudMemoryEntry,{open})),
  open?h('div',{ref:details,tabIndex:-1,className:'cocloud-connection-settings'},entry('authorization',yz),entry('github',CocloudGithubEntry,github),entry('wechat',CocloudWechatEntry,wechat),entry('proxy',CocloudProxyEntry,proxy),
   (!selected||selected==='enterpriseWechat')&&h('section',{'aria-label':'企业微信',className:'min-w-0 text-xs'},
    h('h3',{className:'flex min-h-9 items-center font-medium'},'企业微信'),
    h('div',{className:'flex flex-col gap-2'},h('p',{role:'status'},wecom.busy?'刷新中…':wecomLabel),
     h('p',{className:'break-words text-muted-foreground'},wecomDetail),
     (wecomState==='offline'||wecomState==='abnormal')&&h('button',{type:'button',className:'min-h-9 text-left',onClick:wecom.refresh,disabled:wecom.busy},'重试企业微信'),
     canOpenWecom&&h('a',{href:'/wecom/',target:'_blank',rel:'noopener',className:'inline-flex min-h-9 items-center text-primary underline underline-offset-2'},'打开企业微信桌面')))):null);
}
