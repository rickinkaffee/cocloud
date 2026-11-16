const $=id=>document.getElementById(id);let paused=false,offset=0,memOffset=0,busy=false,searchOffset=0;const labels={pending:'待整理',skipped:'已跳过系统记录',retry_pending:'等待重试',processing:'进行中',completed:'已完成',failed:'失败',paused:'已暂停',waiting:'等待服务',idle:'等待新增记录',error:'异常'};
async function api(path,body){const r=await fetch('/api/cocloud/memory/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Memory-Request':'1'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'请求失败');return d}
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e}
function error(e){$('alert').textContent=e.message}
async function refresh(){if(busy||document.hidden)return;busy=true;try{const d=await api('status');$('alert').textContent=d.modelBlock?.reason||'';paused=d.paused;$('pause').textContent=paused?'继续整理':'暂停整理';$('model').textContent=d.model;$('state').textContent=labels[paused?'paused':d.worker?.status]||'准备中';const j=d.jobs,total=Object.values(j).reduce((a,b)=>a+b,0),done=j.completed||0;$('metrics').replaceChildren(...[['历史会话',d.sessions],['去重消息',d.messages],['完成 / 总批次',done+' / '+total],['失败批次',j.failed||0]].map(([label,value])=>{let e=el('div',undefined,'metric');e.append(el('strong',value.toLocaleString()),el('span',label));return e}));$('progress').max=total||1;$('progress').value=done;$('detail').textContent=`索引：${d.scan?.done||0} / ${d.scan?.total||0} 个文件 · ${d.scan?.status==='complete'?'扫描完成':'扫描中'}。已完成 ${done} 批，待整理 ${j.pending||0} 批。${d.worker?.project?'当前项目：'+d.worker.project:''} ${d.worker?.error||''}`;
if(d.engineStats){const s=d.engineStats;$('engineStats').classList.toggle('error',Boolean(s.failedOperations||s.failedConsolidation));$('engineStats').textContent=`已生成 ${s.facts} 条记忆（含 ${s.observations} 条整合结论）· 待进一步整合 ${s.pendingConsolidation} 条 · 整合失败 ${s.failedConsolidation} 条。批次完成表示提取完成，后台整合会继续。统计更新：${new Date(s.at*1000).toLocaleTimeString()}`;}
$('sources').replaceChildren(...d.sources.map(s=>{const tr=el('tr');for(const v of [s.category,s.device,s.files,s.visible,s.errors])tr.append(el('td',String(v)));return tr}));const bank=$('bank').value;$('bank').replaceChildren(el('option','所有项目（跨项目查询）'));$('bank').firstChild.value='';for(const b of d.banks){const o=el('option',b.project);o.value=b.id;$('bank').append(o)}$('bank').value=bank;
$('events').replaceChildren(...d.events.map(x=>el('div',new Date(x.at*1000).toLocaleString()+' · '+x.detail,'item')));if(d.usage)$('events').prepend(el('p',`模型请求 ${d.usage.requests} 次 · 输入 ${d.usage.inputTokens.toLocaleString()} tokens · 输出 ${d.usage.outputTokens.toLocaleString()} tokens · 错误 ${d.usage.errors} 次`));await jobs();}catch(e){error(e)}finally{busy=false}}
async function jobs(){const d=await api('jobs?offset='+offset+'&status='+$('filter').value);$('jobs').replaceChildren(...d.items.map(x=>{const e=el('div',undefined,'item');e.append(el('strong',`${labels[x.status]||x.status} · ${x.chars.toLocaleString()} 字符`),el('small',x.session));if(x.error)e.append(el('p',x.error,'error'));const b=el('button','查看原文与来源');b.onclick=async()=>{try{const d=await api('evidence?job='+x.id);$('evidenceText').textContent=(d.job?.content||'')+'\n\n来源：\n'+d.sources.map(s=>s.path+':'+s.line).join('\n');$('evidence').showModal()}catch(e){error(e)}};e.append(b);return e}));$('page').textContent='第 '+(offset/30+1)+' 页';$('previous').disabled=!offset;$('next').disabled=d.items.length<30}
for(const [id,action] of [['scan','scan'],['retry','retry'],['pause',null]])$(id).onclick=async()=>{try{await api('control',{action:action||(paused?'resume':'pause')});await refresh()}catch(e){error(e)}};
$('filter').onchange=()=>{offset=0;jobs().catch(error)};$('previous').onclick=()=>{offset=Math.max(0,offset-30);jobs().catch(error)};$('next').onclick=()=>{offset+=30;jobs().catch(error)};$('close').onclick=()=>$('evidence').close();
function render(items){$('results').replaceChildren(...items.map(x=>{const e=el('div',undefined,'item');e.append(el('small',x.project||x.fact_type||x.type||''),el('p',x.text||x.content||JSON.stringify(x)));if(x.document_id){const b=el('button','来源');b.onclick=async()=>{try{const d=await api('evidence?job='+encodeURIComponent(x.document_id));$('evidenceText').textContent=JSON.stringify(d,null,2);$('evidence').showModal()}catch(e){error(e)}};e.append(b)}return e}));if(!items.length)$('results').append(el('p','暂无结果。整理完成的记忆会逐步出现在这里。'))}
async function search(){try{$('search').disabled=true;$('results').textContent='正在检索…';$('moreMemories').hidden=true;const d=await api('search',{query:$('query').value,bank:$('bank').value,bank_offset:searchOffset});$('moreSearch').hidden=!d.has_more;render(d.results.flatMap(b=>b.results.map(x=>({...x,project:b.project}))));if(d.errors.length)$('results').append(el('p',`${d.errors.length} 个项目暂未能检索，以上为部分结果。`,'error'))}catch(e){error(e)}finally{$('search').disabled=false}};
$('search').onclick=()=>{searchOffset=0;search()};$('moreSearch').onclick=()=>{searchOffset+=8;search()};
async function browse(){if(!$('bank').value)throw Error('请先选择一个项目');const d=await api('memories?bank='+$('bank').value+'&offset='+memOffset);const items=d.items||d.results||[];render(items);$('moreMemories').hidden=items.length<20}
$('browse').onclick=()=>{memOffset=0;browse().catch(error)};$('moreMemories').onclick=()=>{memOffset+=20;browse().catch(error)};refresh();setInterval(refresh,8000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});


// Return to the originating workbench view and open its mobile sidebar.
function returnToWorkbench(){
 if(window.parent!==window){window.parent.postMessage({type:'cocloud-memory-close'},location.origin);return}
 let destination='/';
 try{
  const saved=new URL(sessionStorage.getItem('cocloud:memory-return')||'/',location.origin);
  if(saved.origin===location.origin&&!saved.pathname.startsWith('/memory'))destination=saved.pathname+saved.search+saved.hash;
  sessionStorage.setItem('cocloud:memory-open-sidebar','1');
 }catch{}
 if(document.referrer){try{const ref=new URL(document.referrer);if(ref.origin===location.origin&&!ref.pathname.startsWith('/memory')){history.back();return}}catch{}}
 location.assign(destination);
}
document.querySelector('header a').addEventListener('click',event=>{if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();returnToWorkbench()});
let memoryTouch=null,memoryFrame=0,memoryReturning=false;
let memoryVisualX=0;
const reducedMemoryMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function paintMemoryReturn(x){
 memoryVisualX=x;
 if(memoryFrame)return;
 memoryFrame=requestAnimationFrame(()=>{
  memoryFrame=0;
  if(reducedMemoryMotion())return;
  document.body.style.transform=`translate3d(${Math.max(-96,Math.min(96,memoryVisualX))}px,0,0)`;
 });
}
function resetMemoryReturn(){
 if(memoryFrame)cancelAnimationFrame(memoryFrame);memoryFrame=0;memoryVisualX=0;
 document.body.style.removeProperty('transform');document.body.style.removeProperty('will-change');
}
function finishMemoryReturn(dx){
 if(memoryReturning)return;
 memoryReturning=true;
 if(memoryFrame)cancelAnimationFrame(memoryFrame);memoryFrame=0;
 const start=Math.max(-96,Math.min(96,dx));
 if(reducedMemoryMotion()){resetMemoryReturn();returnToWorkbench();return}
 const animation=document.body.animate([{transform:`translate3d(${start}px,0,0)`},{transform:`translate3d(${Math.sign(dx||1)*120}px,0,0)`}],{duration:120,easing:'ease-out',fill:'both'});
 animation.finished.then(()=>{resetMemoryReturn();animation.cancel();returnToWorkbench()}).catch(()=>{memoryReturning=false;resetMemoryReturn()});
}
document.addEventListener('touchstart',event=>{
 if(memoryTouch?.horizontal)resetMemoryReturn();
 memoryTouch=null;
 if(memoryReturning||innerWidth>=768||event.touches.length!==1||document.querySelector('dialog[open]')||event.target.closest('input,textarea,select,pre,.table-wrap,[contenteditable="true"]'))return;
 const t=event.touches[0];memoryTouch={id:t.identifier,x:t.clientX,y:t.clientY,horizontal:false};
},{passive:true,capture:true});
document.addEventListener('touchmove',event=>{
 if(!memoryTouch)return;
 if(event.touches.length!==1){memoryTouch=null;resetMemoryReturn();return}
 const t=event.touches[0],dx=t.clientX-memoryTouch.x,dy=t.clientY-memoryTouch.y;
 if(!memoryTouch.horizontal){
  if(Math.abs(dy)>=8&&Math.abs(dy)>=Math.abs(dx)*.8){memoryTouch=null;return}
  if(Math.abs(dx)<14||Math.abs(dx)<Math.abs(dy)*1.733)return;
  if(!event.cancelable){memoryTouch=null;return}
  memoryTouch.horizontal=true;document.body.style.willChange='transform';
 }
 if(!event.cancelable){memoryTouch=null;resetMemoryReturn();return}
 event.preventDefault();event.stopPropagation();paintMemoryReturn(dx);
},{passive:false,capture:true});
document.addEventListener('touchend',event=>{
 const start=memoryTouch;memoryTouch=null;if(!start?.horizontal)return;
 const t=Array.from(event.changedTouches).find(t=>t.identifier===start.id);
 if(event.cancelable)event.preventDefault();event.stopPropagation();
 if(t&&Math.abs(t.clientX-start.x)>=32)finishMemoryReturn(t.clientX-start.x);
 else resetMemoryReturn();
},{passive:false,capture:true});
document.addEventListener('touchcancel',()=>{memoryTouch=null;resetMemoryReturn()},{passive:true,capture:true});
// Android predictive-back uses the same return destination; cancellation stays here.
let memoryNativeId=null;
window.addEventListener('cocloud-native-sidebar',event=>{
 if(document.querySelector('dialog[open]'))return;
 const info=event.detail||{};
 if(info.action==='start'){memoryNativeId=info.id;resetMemoryReturn();event.preventDefault()}
 else if(['progress','cancel','finish'].includes(info.action)&&memoryNativeId!==null&&info.id===memoryNativeId){
  event.preventDefault();
  if(info.action==='progress')paintMemoryReturn((info.edge==='right'?-1:1)*Math.max(0,Math.min(1,Number(info.progress)||0))*96);
  else {memoryNativeId=null;if(info.action==='finish')finishMemoryReturn(memoryVisualX||40);else resetMemoryReturn()}
 }else if(['open','close','back'].includes(info.action)){event.preventDefault();returnToWorkbench()}
});

document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!document.querySelector("dialog[open]")&&parent!==window){event.preventDefault();returnToWorkbench()}});

let personalOffset=0;
async function loadModels(){
 try{const d=await api('models');const selected=d.selection;const select=$('dreamModel');select.replaceChildren();
 if(!selected){const legacy=el('option','请选择已配置的模型');legacy.value='';select.append(legacy)}
 for(const m of d.models){const o=el('option',m.label+' · '+d.providerLabel);o.value=JSON.stringify({model:m.id,provider:m.provider});select.append(o);if(selected?.model===m.id&&selected?.provider===m.provider)o.selected=true}
 }catch(e){$('modelHint').textContent=e.message}
}
$('saveModel').onclick=async()=>{try{
 if(!$('dreamModel').value)throw Error('请选择工作台模型');$('saveModel').disabled=true;
 const d=await api('model',JSON.parse($('dreamModel').value));$('modelHint').textContent='已保存 '+d.selection.model+'。用于之后的整理请求；如整理已暂停，点击继续整理后运行。';await refresh();
 }catch(e){$('modelHint').textContent=e.message}finally{$('saveModel').disabled=false}};
async function loadPersonal(){try{
 const d=await api('profile');const host=$('personalMemories');
 if(host.dataset.version===d.version)return;host.dataset.version=d.version;
 $('profileStatus').textContent=d.privacy;host.replaceChildren();
 for(const section of d.document||[]){
  const heading=el('h3',section.title);const paragraph=el('p');host.append(heading,paragraph);
  for(const sentence of section.sentences){
   paragraph.append(document.createTextNode(sentence.text+' '));
   const ref=el('button','['+sentence.number+']','reference-mark');ref.setAttribute('aria-label','引用 '+sentence.number);ref.setAttribute('aria-expanded','false');
   const detail=el('div',undefined,'reference-detail');detail.hidden=true;host.append(detail);
   ref.onclick=async()=>{detail.hidden=!detail.hidden;ref.setAttribute('aria-expanded',String(!detail.hidden));if(!detail.hidden&&!detail.dataset.loaded){try{
    const result=await api('profile?reference='+encodeURIComponent(sentence.reference));detail.replaceChildren(el('p',result.evidence?.quote||'该引用已隐藏或不可用。'));
    const hide=el('button','隐藏这段记忆');hide.onclick=async()=>{await api('profile',{hide:sentence.reference});delete host.dataset.version;await loadPersonal()};detail.append(hide);detail.dataset.loaded='true';
   }catch(e){detail.textContent=e.message}}};paragraph.append(ref,document.createTextNode(' '));
  }
 }
 if(!d.document?.length)host.append(el('p','暂无可公开的协作记忆，隐私内容不会用来补齐文档。','muted'));
 }catch(e){$('profileStatus').textContent=e.message}}
loadModels();loadPersonal();setInterval(()=>{if(!document.hidden)loadPersonal()},30000);
