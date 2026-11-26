const configuredHosts=globalThis.WORKBENCH_SSH_HOSTS;
const cocloudSshHosts=Array.isArray(configuredHosts)?configuredHosts.filter(host=>host&&typeof host.name==="string"&&/^[A-Za-z0-9_-]+$/.test(host.alias)&&typeof host.alias==="string"):[];
function cocloudUseSshReport(host,projects){
 const [status,setStatus]=$.useState(null);
 $.useEffect(()=>{
  let active=null;
  async function refresh(){
   if(document.hidden||active)return;
   const request=new AbortController();active=request;
   const timeout=setTimeout(()=>request.abort(),projects?14000:7500);
   try{
    const response=await fetch((projects?'/api/cocloud/proxy/ssh-projects':'/api/cocloud/proxy/ssh-status')+'?host='+host.alias,{credentials:'same-origin',cache:'no-store',signal:request.signal});
    if(!response.ok)throw Error();
    const data=await response.json();
    if(typeof data.reachable!=='boolean'||!Number.isFinite(data.checkedAt)||data.name!==host.name||data.alias!==host.alias)throw Error();
    if(projects&&(!data.reachable||!Array.isArray(data.projects?.items)||!Array.isArray(data.projects?.missing)))throw Error();
    if(active===request)setStatus(data);
   }catch{if(active===request)setStatus({error:true});}
   finally{clearTimeout(timeout);if(active===request)active=null;}
  }
  function cancel(){const request=active;active=null;request?.abort();}
  function visible(){if(document.hidden)cancel();else refresh();}
  refresh();const timer=setInterval(refresh,30000);document.addEventListener('visibilitychange',visible);
  return()=>{cancel();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[host,projects]);
 return status;
}
function CocloudSshProjects({host}){
 const report=cocloudUseSshReport(host,true),h=$.createElement;
 const names=globalThis.WORKBENCH_SSH_PROJECT_NAMES ?? {};
 if(!report||report.error)return h('p',{role:'status',className:'py-2 text-xs text-muted-foreground'},report?'项目清单暂不可用':'正在读取项目…');
 const {items,missing}=report.projects;
 return h('div',{'data-ssh-projects':true,className:'mt-2 border-t border-border pt-2 text-sm'},
  h('div',{className:'text-xs text-muted-foreground'},'已检测到的项目 · '+items.length),
  missing.length?h('p',{role:'status'},missing.join('、')+'状态未能核实'):null,
  !items.length&&!missing.length?h('p',null,'未检测到运行中的项目'):null,
  h('ul',null,...items.map(({id,kind})=>h('li',{key:kind+':'+id,className:'flex flex-wrap items-baseline justify-between gap-x-3 py-1'},h('span',{className:'min-w-0 break-words'},Object.hasOwn(names,id)?names[id]:id),h('span',{className:'text-xs text-muted-foreground'},kind)))));
}
function CocloudSshRow({host}){
 const status=cocloudUseSshReport(host,false),[open,setOpen]=$.useState(false),h=$.createElement;
 const label=!status?'检测中…':status.error?'状态暂不可用':status.reachable?'SSH 可登录':'SSH 登录失败';
 return h('details',{'data-ssh-environment':host.alias,onToggle:event=>setOpen(event.currentTarget.open),className:'border-t border-border px-3 py-3 sm:px-4'},
  h('summary',{className:'cursor-pointer text-sm'},h('span',{className:'font-medium'},host.name),
   h('span',{className:'ml-2 text-xs text-muted-foreground','aria-live':'polite'},label),
   status?.checkedAt?h('span',{className:'ml-2 text-xs text-muted-foreground'},'上次检测 '+new Date(status.checkedAt).toLocaleTimeString()):null),
  open?h(CocloudSshProjects,{host}):null);
}
function CocloudSshEnvironment(){
 return cocloudSshHosts.map(host=>$.createElement(CocloudSshRow,{key:host.alias,host}));
}
