import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {chromium} from 'playwright-core';
const root=new URL('../web/',import.meta.url),errors=[],actions=[];
const status={model:'example-model',sessions:2,messages:12,jobs:{completed:2,pending:3},worker:{status:'processing'},scan:{done:5,total:5,status:'complete'},sources:[{category:'dsh',device:'server-memory-archive',files:3,visible:12,errors:0}],banks:[{id:'p1',project:'/项目'}],events:[]};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 for(const width of [390,1200]) for(const mode of ['light','dark','ocean','custom']){

 const page=await browser.newPage({viewport:{width,height:900},hasTouch:true,isMobile:width<768});page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMedia({colorScheme:mode==='light'?'dark':'light'});
 await page.addInitScript(mode=>{
 localStorage.setItem('t3code:theme',mode==='custom'?'test-theme':mode);
 localStorage.setItem('t3code:theme-appearance-mode',mode==='light'?'light':'dark');
 if(mode==='custom')localStorage.setItem('t3code:themes:v1',JSON.stringify([{id:'test-theme',label:'Test',appearance:'dark',colors:{canvas:'#182838',surface:'#203040',accent:'#abcdef',messageAction:'#abcdef',text:'#efefef'}}]));
 },mode);
 await page.route('**/*',async route=>{const u=new URL(route.request().url());const p=u.pathname;
 if(p==='/host')return route.fulfill({contentType:'text/html',body:'<html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/host.css></head><body><input id=draft value=untouched><a id=entry href=/memory/>记忆中心</a><script src=/host.js></script></body></html>'});
 if(p==='/host.css')return route.fulfill({contentType:'text/css',body:await fs.readFile(new URL('../../frontend/src/motion.css',import.meta.url))});
 if(p==='/host.js')return route.fulfill({contentType:'text/javascript; charset=utf-8',body:(await fs.readFile(new URL('../../frontend/src/memory-entry.js',import.meta.url),'utf8')).replace(/^import .*$/mg,'').replace('export function CocloudMemoryEntry','function CocloudMemoryEntry')+";window.hostMarker={};document.querySelector('#entry').onclick=openCocloudMemory;"});
 if(p==='/return-test')return route.fulfill({body:'<html><body>Workbench return</body></html>',contentType:'text/html'});
 if(p.startsWith('/api/')){let data={};if(p.endsWith('/status'))data=status;
 else if(p.endsWith('/models'))data={models:[{id:'gpt-6.1-sol',label:'GPT-6.1-Sol',provider:'codex'},{id:'gpt-6-luna',label:'GPT-6-Luna',provider:'codex'}],providerLabel:'Configured provider',selection:{provider:'codex',model:'gpt-6.1-sol'}};
 else if(p.endsWith('/model')){actions.push(route.request().postDataJSON());data={ok:true,selection:actions.at(-1)}}
 else if(p.endsWith('/profile')){if(route.request().method()==='POST'){actions.push(route.request().postDataJSON());data={ok:true}}else if(u.searchParams.has('reference'))data={evidence:{quote:'以后请先给结论再解释原因'}};else data={version:'v1',privacy:'个人隐私已隐去',document:[{title:'沟通方式',sentences:[{text:'优先给简明结论',reference:'pm1',number:1}]}]}}

 else if(p.endsWith('/jobs'))data={items:[{id:'j1',session:'codex:s1',status:'completed',chars:200}]};
 else if(p.endsWith('/control')){actions.push(route.request().postDataJSON());data={ok:true};status.paused=actions.at(-1).action==='pause'}
 else if(p.endsWith('/search'))data={results:[{project:'/项目',results:[{text:'已记住发布前回归要求',document_id:'j1'}]}],errors:[],has_more:false};
 else if(p.endsWith('/evidence'))data={job:{content:'用户原话'},sources:[{path:'/source/session.jsonl',line:9}]};
 else if(p.endsWith('/memories'))data={items:[{text:'项目记忆'}]};
 return route.fulfill({json:data});}
 if(p.includes('/fonts/'))return route.fulfill({body:await fs.readFile(new URL('../web/fonts/'+p.split('/').pop(),import.meta.url)),contentType:'font/woff2'});
 const file=p.split('/').pop()||'index.html';if(!['app.js','theme.js','style.css','workbench.css','index.html'].includes(file))return route.abort();
return route.fulfill({body:await fs.readFile(new URL(file,root)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });
 await page.goto('http://memory.test/memory/');await page.getByText('2 / 5',{exact:true}).waitFor();
 assert.equal(await page.locator('table tbody tr').count(),1);
 await page.locator('#personalMemories').getByText('优先给简明结论',{exact:false}).waitFor();
 await page.locator('#dreamModel').selectOption(JSON.stringify({model:'gpt-6-luna',provider:'codex'}));await page.locator('#saveModel').click();
 await page.getByText(/已保存 gpt-6-luna/).waitFor();assert.equal(actions.at(-1).model,'gpt-6-luna');
 assert.equal(await page.locator('.reference-detail:visible').count(),0);
 await page.getByRole('button',{name:'引用 1',exact:true}).click();await page.getByText('以后请先给结论再解释原因',{exact:true}).waitFor();
 const hiddenRequest=page.waitForRequest(r=>r.url().endsWith('/profile')&&r.method()==='POST');
 await page.getByRole('button',{name:'隐藏这段记忆'}).click();assert.equal((await hiddenRequest).postDataJSON().hide,'pm1');

 assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('dark')),mode!=='light');
 const styles=await page.evaluate(()=>{
 const el=document.createElement('div');document.body.append(el);
 const color=token=>{el.style.backgroundColor='var('+token+')';return getComputedStyle(el).backgroundColor};
 const result={background:getComputedStyle(document.body).backgroundColor,expectedBackground:color('--background'),card:getComputedStyle(document.querySelector('.panel')).backgroundColor,expectedCard:color('--card'),button:getComputedStyle(document.querySelector('#search')).backgroundColor,expectedButton:color('--primary'),font:getComputedStyle(document.body).fontFamily,id:document.documentElement.dataset.themeId};el.remove();return result;
 });
 assert.equal(styles.background,styles.expectedBackground);assert.equal(styles.card,styles.expectedCard);assert.equal(styles.button,styles.expectedButton);assert.match(styles.font,/Inter|Segoe|system-ui/);
 if(mode==='ocean'){assert.equal(styles.id,'ocean');assert.match(styles.background,/0.242641/)}
 if(mode==='custom'){assert.equal(styles.background,'rgb(24, 40, 56)');assert.equal(styles.card,'rgb(32, 48, 64)');assert.equal(styles.button,'rgb(171, 205, 239)')}

 await page.locator('#pause').click();await page.getByRole('button',{name:'继续整理',exact:true}).waitFor();assert.equal(actions.at(-1).action,'pause');
 await page.locator('#pause').click();
 await page.locator('#query').fill('发布要求');await page.locator('#search').click();await page.getByText('已记住发布前回归要求',{exact:true}).waitFor();
 await page.getByRole('button',{name:'查看原文与来源'}).click();await page.locator('dialog[open]').waitFor();assert.match(await page.locator('#evidenceText').textContent(),/用户原话/);await page.locator('#close').click();
 await page.locator('#bank').selectOption('p1');await page.locator('#browse').click();await page.getByText('项目记忆',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // A change in another workbench tab must update this already-open page.
 await page.evaluate(()=>{localStorage.setItem('t3code:theme','system');localStorage.setItem('t3code:theme-appearance-mode','system');localStorage.removeItem('t3code:theme-halves:v1');window.dispatchEvent(new StorageEvent('storage',{key:'t3code:theme'}))});
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
 await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>!document.documentElement.classList.contains('dark'));
 await page.evaluate(()=>{localStorage.setItem('t3code:theme-halves:v1',JSON.stringify({light:'ocean',dark:'grove'}));window.dispatchEvent(new StorageEvent('storage',{key:'t3code:theme-halves:v1'}))});
 assert.equal(await page.locator('html').getAttribute('data-theme-id'),'ocean');
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.themeId==='grove');
 
 // Real browser scrolling catches the inherited host body overflow lock.
 await page.evaluate(()=>window.scrollTo(0,0));
 const cdp=await page.context().newCDPSession(page);
 const swipe=async(x,y,dx,dy)=>{
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/10,y:y+dy*i/10}]});await page.waitForTimeout(20)}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 };
 await swipe(width/2,650,0,-350);
 await page.waitForFunction(()=>scrollY>80);
 assert.equal(new URL(page.url()).pathname,'/memory/','vertical scrolling must stay in memory');
 await page.evaluate(()=>window.scrollTo(0,0));
 if(width<768){
  await page.evaluate(()=>sessionStorage.setItem('cocloud:memory-return','/return-test'));
  // Native cancellation must neither navigate nor leave a sidebar return flag.
  await page.evaluate(()=>{
   window.dispatchEvent(new CustomEvent('cocloud-native-sidebar',{cancelable:true,detail:{action:'start',id:1}}));
   window.dispatchEvent(new CustomEvent('cocloud-native-sidebar',{cancelable:true,detail:{action:'cancel',id:1}}));
  });
  assert.equal(new URL(page.url()).pathname,'/memory/');
  // Diagonal and initially sideways vertical thumb arcs stay on memory.
  for(const sign of [-1,1]) {
   await page.evaluate(()=>window.scrollTo(0,0));
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:width/2,y:650}]});
   for(const[dx,dy]of [[5,-3],[9,-10],[14,-36],[18,-85],[22,-150]])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width/2+sign*dx,y:650+dy}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForFunction(()=>scrollY>20);assert.equal(new URL(page.url()).pathname,'/memory/');
  }
  await page.evaluate(()=>window.scrollTo(0,0));
  // Horizontal table interactions must not navigate.
  await page.waitForTimeout(400);
  await page.locator('.table-wrap').scrollIntoViewIfNeeded();
  await page.locator('.table-wrap').scrollIntoViewIfNeeded();
  const table=await page.locator('.table-wrap').boundingBox();
  await swipe(table.x+table.width-20,table.y+20,-130,0);
  await page.waitForFunction(()=>document.querySelector('.table-wrap').scrollLeft>0);
  await swipe(table.x+20,table.y+20,100,0);
  assert.equal(new URL(page.url()).pathname,'/memory/');
  await page.evaluate(()=>window.scrollTo(0,0));
  await swipe(80,110,160,5);
  await page.waitForURL('**/return-test');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('cocloud:memory-open-sidebar')),'1');
 }
 // Opening and closing memory must retain the same host document and draft.
 await page.goto('http://memory.test/host');
 await page.locator('#draft').fill('unsent draft');
 await page.evaluate(()=>{window.originalMarker=window.hostMarker;window.returnLeft=0;window.addEventListener('cocloud-native-sidebar',e=>{if(e.detail?.action==='show-left')window.returnLeft++})});
 for(const method of ['link','swipe-left','swipe-right','browser','native','native-right']){

  const beforeReturns=await page.evaluate(()=>window.returnLeft);
  await page.locator('#entry').click();
  const frame=page.frameLocator('[data-memory-panel] iframe');
  await frame.locator('#metrics strong').first().waitFor();
  if(method==='link')await frame.locator('header a').click();
  else if(method==='browser')await page.goBack();
  else if(method==='native'||method==='native-right')await page.evaluate(action=>window.dispatchEvent(new CustomEvent('cocloud-native-sidebar',{cancelable:true,detail:{action}})),method==='native'?'back':'close');
  else if(width<768)await swipe(method==='swipe-left'?width-80:80,110,method==='swipe-left'?-160:160,5);
  else await frame.locator('header a').click();
  await page.waitForFunction(()=>!document.querySelector('[data-memory-panel]')&&!history.state?.cocloudMemory);
  assert.equal(await page.locator('#draft').inputValue(),'unsent draft');
  assert.equal(await page.evaluate(()=>window.hostMarker===window.originalMarker),true);
  assert.equal(new URL(page.url()).pathname,'/host');
  assert.equal(await page.evaluate(()=>window.returnLeft),beforeReturns+1,'memory close must reveal left sidebar exactly once');
 }
 // A failed iframe must not strand the user on a blank page.
 await page.route('**/memory/?open=*',route=>route.fulfill({status:503,contentType:'text/html',body:'<html><body>temporarily unavailable</body></html>'}));
 await page.locator('#entry').click();
 try {
  await page.locator('.memory-load-status').getByText(/加载失败|暂不可用|暂未加载完成/).waitFor();
 } catch(error) {
  console.error('Memory recovery diagnostic', await page.evaluate(()=>({panel:!!document.querySelector('[data-memory-panel]'),status:document.querySelector('.memory-load-status')?.textContent,hidden:document.querySelector('.memory-load-status')?.hidden,frame:document.querySelector('[data-memory-panel] iframe')?.src,history:history.state})));
  throw error;
 }
 await page.getByRole('button',{name:'返回工作台',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('[data-memory-panel]')&&!history.state?.cocloudMemory);
 assert.equal(await page.locator('#draft').inputValue(),'unsent draft');
 await page.unroute('**/memory/?open=*');
 await page.locator('#entry').click();await page.frameLocator('[data-memory-panel] iframe').locator('#state').waitFor();
 await page.waitForFunction(()=>document.querySelector('.memory-load-status')?.hidden);
 await page.frameLocator('[data-memory-panel] iframe').locator('header a').click();
 await page.waitForFunction(()=>!document.querySelector('[data-memory-panel]'));
 await cdp.detach();
 await page.close();
 }
 assert.deepEqual(errors,[]);console.log('Memory UI regression passed: desktop/mobile, pause/resume, search, evidence, pagination controls, saved light/dark/built-in/custom themes, live theme/system changes, split themes, real vertical touch scrolling, bidirectional horizontal return, vertical thumb-arc rejection, native cancel, embedded return preserves host document and draft, no overflow or page errors');
}finally{await browser.close()}
