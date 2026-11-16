import * as X from "react";
// Mounted by the workbench's React sidebar footer between Devices and Balances.
// Uses the host theme/classes and performs no background history requests.
export function CocloudMemoryEntry({language = navigator.language} = {}) {
 const h=X.createElement;
 const english=language?.startsWith('en');
 const title=english?'Memory center':'记忆中心';
 const svg=(paths)=>h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.75,strokeLinecap:'round',strokeLinejoin:'round',className:'size-4 shrink-0','aria-hidden':true},...paths.map(d=>h('path',{key:d,d})));
 return h('section',{'data-workbench-memory':true,'aria-label':title,className:'min-w-0 rounded-xl border border-sidebar-border bg-secondary/40 px-3 py-2'},
  h('a',{href:'/memory/',onClick:openCocloudMemory,className:'flex min-h-9 w-full items-center gap-2 text-left text-xs text-sidebar-foreground rounded-md focus-visible:outline focus-visible:outline-2',title:english?'History, consolidation progress and memory search':'历史来源、整理进度与记忆检索'},
   svg(['M4 19.5A2.5 2.5 0 0 1 6.5 17H20','M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Z','M8 7h8','M8 11h6']),
   h('span',{className:'min-w-0 flex-1 font-medium'},title),
   h('span',{className:'shrink-0 text-muted-foreground'},english?'Open':'查看'),
   svg(['m9 5 7 7-7 7'])
  )
 );
}

// Keep the workbench document mounted: closing memory never navigates the host.
function openCocloudMemory(event) {
 if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 event.preventDefault();
 if(document.querySelector('[data-memory-panel]'))return;
 const trigger=event.currentTarget;
 const panel=document.createElement('div');panel.dataset.memoryPanel='';
 panel.setAttribute('role','dialog');panel.setAttribute('aria-label','记忆中心');
 const frame=document.createElement('iframe');frame.title='记忆中心';
 const status=document.createElement('div');status.className='memory-load-status';status.setAttribute('role','status');
 const note=document.createElement('p');note.textContent='正在加载记忆中心…';
 const back=document.createElement('button');back.textContent='返回工作台';
 const retry=document.createElement('button');retry.textContent='重新加载';
 status.append(note,back,retry);panel.append(status,frame);
 let timeout=null;
 const load=()=>{status.hidden=false;note.textContent='正在加载记忆中心…';clearTimeout(timeout);frame.src='/memory/?open='+Date.now();timeout=setTimeout(()=>{note.textContent='记忆中心暂未加载完成，请重试或返回工作台。'},12000)};
 frame.addEventListener('load',()=>{
  try{
   if(frame.contentDocument?.querySelector('#state')&&frame.contentDocument?.querySelector('main')){clearTimeout(timeout);status.hidden=true;frame.contentWindow?.focus()}
   else{status.hidden=false;note.textContent='记忆中心加载失败或登录已失效，请返回工作台后重试。'}
  }catch{status.hidden=false;note.textContent='记忆中心暂不可用，请重试。'}
 });

 // Stay inside the existing mobile dialog's focus boundary when it is open.
 (trigger.closest('[role="dialog"]')||document.body).append(panel);
 const marker='memory-'+Date.now();history.pushState({...history.state,cocloudMemory:marker},'',location.href);
 let closed=false;
 const close=(fromHistory=false)=>{
  if(closed)return;closed=true;clearTimeout(timeout);
  window.removeEventListener('message',message);window.removeEventListener('popstate',pop);
  window.removeEventListener('cocloud-native-sidebar',native,true);window.removeEventListener('keydown',key,true);
  panel.remove();
  window.dispatchEvent(new CustomEvent('cocloud-native-sidebar',{cancelable:true,detail:{action:'show-left'}}));
  trigger.focus({preventScroll:true});
  if(!fromHistory&&history.state?.cocloudMemory===marker)history.back();
 };
 const message=e=>{if(e.origin===location.origin&&e.source===frame.contentWindow&&e.data?.type==='cocloud-memory-close')close()};
 const pop=()=>close(true);
 const native=e=>{
  e.preventDefault();e.stopImmediatePropagation();
  if(!status.hidden&&['back','open','finish'].includes(e.detail?.action)){close();return}
  frame.contentWindow?.dispatchEvent(new CustomEvent('cocloud-native-sidebar',{cancelable:true,detail:e.detail}));
 };
 const key=e=>{if(e.key==='Escape'){e.preventDefault();close()}};
 window.addEventListener('message',message);window.addEventListener('popstate',pop);
 window.addEventListener('cocloud-native-sidebar',native,true);window.addEventListener('keydown',key,true);
 back.onclick=()=>close();retry.onclick=load;load();
}
