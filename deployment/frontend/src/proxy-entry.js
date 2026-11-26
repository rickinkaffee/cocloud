// Server-side proxy control: no controller secrets or subscriptions reach the client.
function CocloudProxyEntry({connection=null}={}) {
 const h=X.createElement;
 const [open,setOpen]=X.useState(false),[localState,setLocalState]=X.useState(null),[localBusy,setBusy]=X.useState(false),[localError,setError]=X.useState(''),[report,setReport]=X.useState(null);
 const state=connection?connection.state:localState,setState=connection?connection.setState:setLocalState,busy=localBusy||connection?.busy,error=connection?connection.error:localError,expanded=connection||open;
 async function request(path='',body){
  const response=await fetch('/api/cocloud/proxy'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json','X-Cocloud-Proxy':'1'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'请求失败');return data;
 }
 async function run(action){setBusy(true);setError('');if(connection)connection.setError('');try{await action()}catch(e){const message=e.name==='TimeoutError'?'请求超时，请重新展开确认结果':e.message||'请求失败';setError(message);if(connection){connection.setState(null);connection.setError(message);}}finally{setBusy(false)}}
 function refresh(){return run(async()=>{setState(null);setReport(null);setState(await request())})}
 const button='min-h-9 rounded-md border border-sidebar-border px-2 text-xs disabled:opacity-50';
 return h('section',{'data-workbench-proxy':true,className:connection?'min-w-0 text-xs':'min-w-0 rounded-xl border border-sidebar-border bg-secondary/40 px-3 py-2'},
  connection?h('h3',{className:'flex min-h-9 items-center font-medium'},'服务器代理'):h('button',{type:'button','aria-expanded':open,onClick:()=>{setOpen(!open);if(!open)refresh()},className:'flex min-h-9 w-full items-center gap-2 text-left text-xs'},
   h('span',{'aria-hidden':true},'⇄'),h('span',{className:'min-w-0 flex-1 font-medium'},'服务器代理'),h('span',{className:'text-muted-foreground'},open?'收起':'展开')),
  expanded?h('div',{className:'flex flex-col gap-2 text-xs'},
   state?h('div',null,
    h('div',{className:'flex min-h-9 items-center justify-between gap-2'},
     h('span',null,state.enabled?'已启用':'已关闭'),
     h('button',{type:'button',role:'switch','aria-label':'启用服务器代理','aria-checked':state.enabled,
      disabled:busy||!state.canControl,className:'cocloud-proxy-switch',
      onClick:()=>{const enabled=!state.enabled;setReport(null);run(async()=>setState(await request('',{enabled})))},
      style:{backgroundColor:state.enabled?'var(--primary)':'var(--input)'}},
      h('span',{'aria-hidden':true,className:'cocloud-proxy-switch-thumb',style:{transform:state.enabled?'translateX(16px)':'translateX(0)'}}))),
    h('p',{role:'status'},state.temporary?'GitHub 临时使用中，结束后自动恢复':state.enabled?'运行中':'未运行',state.startup?' · 开机自动启用':' · 开机不启用'),
    !state.canControl?h('p',null,'当前会话只有查看权限'):null):null,
   h('div',{className:'flex flex-wrap gap-2'},
    h('button',{type:'button',className:button,disabled:busy||!state?.enabled||!state?.canControl,onClick:()=>run(async()=>setReport(await request('/test',{})))},'连接测速')),
   busy?h('p',{role:'status'},'正在处理，请稍候…'):null,
   error?h('p',{role:'alert'},error):null,
   report?h('div',{'aria-live':'polite'},
    h('p',{className:'text-muted-foreground'},'测试时间：'+new Date(report.checkedAt).toLocaleTimeString()),
    ...report.results.map((r,i)=>h('p',{key:i,className:'break-words'},r.label+'：'+(r.ok?r.latencyMs+' ms':r.message)))):null
  ):null
 );
}
