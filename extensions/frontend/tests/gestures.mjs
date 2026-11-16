import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
const output=process.argv[2],hookName=process.argv[3]||'Rb';
const hook=readFileSync(output+'/'+hookName+'-compiled.js','utf8');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
let checks=0;const errors=[];
try {
for(const width of [360,390,430,767]) {
 const page=await browser.newPage({viewport:{width,height:844},hasTouch:true,isMobile:true});
 page.setDefaultTimeout(2500);page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(`<meta name=viewport content="width=device-width,initial-scale=1"><style>
 body{margin:0}#content{position:fixed;inset:0;overflow-y:auto}#text{height:2400px}#code{overflow:auto;width:200px}#code>div{width:600px}
 #drawer,#tools{position:fixed;top:0;width:calc(100vw - 24px);height:100vh;overflow-y:auto;background:white}
 #drawer{left:0;transform:translateX(-100%)}#tools{right:0;transform:translateX(100%)}
 #drawer[data-open],#tools[data-open]{transform:translateX(0)}
 [data-workbench-sidebar-backdrop],[data-workbench-tools-backdrop]{position:fixed;inset:0;pointer-events:none;opacity:0}
 </style><main id=content><div id=text>Conversation</div><pre id=code><div>Scrollable code</div></pre><input id=input><canvas id=canvas></canvas></main><nav data-workbench-tools id=toolbar></nav><div data-workbench-sidebar-backdrop></div><div id=drawer data-sidebar=sidebar data-mobile=true data-side=left><div style="height:2400px">Left content</div></div><div data-workbench-tools-backdrop></div><div id=tools data-workbench-tools data-slot=sheet-popup><div style="height:2400px">Right content</div></div>`);
 await page.addStyleTag({content:readFileSync(new URL('../src/motion.css',import.meta.url),'utf8')});
 await page.evaluate(({hook,hookName})=>{
  window.openState=false;let returnFlag='1';
  const sessionStorage={getItem:()=>returnFlag,removeItem:()=>returnFlag=null};
  let effects=0;const X={useEffectEvent:f=>effects++===0?()=>window.openState:f,useEffect:f=>window.cleanup=f()};
  const Fv={flushSync:f=>f()},Pv=Fv;
  window.addEventListener('cocloud-tools-panel',e=>{e.preventDefault();document.querySelector('#tools').toggleAttribute('data-open',e.detail.action==='open')});
  eval(hook+';'+hookName+'(true,false,value=>{window.openState=value;document.querySelector("#drawer").toggleAttribute("data-open",value)})');
  if(!window.openState||returnFlag!==null)throw Error('memory return flag not consumed');
  window.openState=false;document.querySelector('#drawer').removeAttribute('data-open');
  let target;
  window.fire=(type,x,y,id='text',count=1)=>{
   if(type==='touchstart')target=document.getElementById(id);
   const points=Array.from({length:count},(_,identifier)=>({identifier,clientX:x,clientY:y,pageX:x,pageY:y,target}));
   const e=new Event(type,{bubbles:true,cancelable:true});
   Object.defineProperty(e,'touches',{value:['touchend','touchcancel'].includes(type)?[]:points});
   Object.defineProperty(e,'changedTouches',{value:points});target.dispatchEvent(e);return e.defaultPrevented;
  };
 },{hook,hookName});
 const fire=(...args)=>page.evaluate(args=>window.fire(...args),args);
 const state=()=>page.evaluate(()=>({left:window.openState,right:document.querySelector('#tools').hasAttribute('data-open')}));
 const idle=()=>page.waitForFunction(()=>!document.documentElement.dataset.workbenchSidebarMotion&&!document.documentElement.dataset.workbenchToolsMotion);
 const setState=async side=>{await idle();await page.evaluate(side=>{window.openState=side==='left';document.querySelector('#drawer').toggleAttribute('data-open',side==='left');document.querySelector('#tools').toggleAttribute('data-open',side==='right');},side);await page.waitForTimeout(280);};
 const native=detail=>page.evaluate(detail=>!window.dispatchEvent(new CustomEvent('cocloud-native-sidebar',{cancelable:true,detail})),detail);
 const transform=side=>page.$eval(side==='left'?'#drawer':'#tools',el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
 // Opening is decided by the starting edge; middle swipes never open panels.
 for(const sign of [-1,1])for(const x of [width/2,37,width-37]){
  await fire('touchstart',x,400);assert.equal(await fire('touchmove',x+sign*80,405),false);await fire('touchend',x+sign*80,405);
  assert.deepEqual(await state(),{left:false,right:false});checks++;
 }
 for(const side of ['left','right'])for(const y of [100,422,700]) {
  const x=side==='left'?20:width-20,sign=side==='left'?1:-1;
  await fire('touchstart',x,y);assert.equal(await fire('touchmove',x+sign*8,y+2),false);
  assert.equal(await fire('touchmove',x+sign*20,y+4),true);
  await fire('touchmove',x+sign*70,y+6);await page.evaluate(()=>new Promise(requestAnimationFrame));
  const w=await page.$eval(side==='left'?'#drawer':'#tools',e=>e.getBoundingClientRect().width);
  assert.ok(Math.abs(Math.abs(await transform(side))-(w-70))<2,'latest touch sample must paint in this frame');checks++;
  await fire('touchend',x+sign*70,y+6);await idle();assert.equal((await state())[side],true);
  for(const closeSign of [-1,1]) {
   if(!(await state())[side])await setState(side);
   const id=side==='left'?'drawer':'tools';
   await fire('touchstart',width/2,y,id);assert.equal(await fire('touchmove',width/2+closeSign*20,y+3,id),true);
   await fire('touchmove',width/2+closeSign*60,y+5,id);await page.evaluate(()=>new Promise(requestAnimationFrame));
   assert.ok(Math.abs(await transform(side)-closeSign*60)<2,'closing must follow either finger direction');
   await fire('touchend',width/2+closeSign*60,y+5,id);await idle();assert.deepEqual(await state(),{left:false,right:false});checks++;
  }
 }
 for(const side of ['left','right']) {
  const x=side==='left'?20:width-20,wrong=side==='left'?-1:1;
  await fire('touchstart',x,400);assert.equal(await fire('touchmove',x+wrong*20,401),false);await fire('touchend',x+wrong*20,401);
  assert.deepEqual(await state(),{left:false,right:false});checks++;
 }
 // Vertical intent and thumb arcs remain scrolls, even after a late horizontal turn.
 for(const side of ['closed','left','right'])for(const sx of [-1,1])for(const sy of [-1,1]){
  await setState(side);const id=side==='left'?'drawer':side==='right'?'tools':'text';const x=side==='closed'?(sx>0?20:width-20):width/2;
  await fire('touchstart',x,400,id);
  for(const [dx,dy] of [[5,3],[9,10],[20,36],[45,100],[140,110]])assert.equal(await fire('touchmove',x+sx*dx,400+sy*dy,id),false);
  await fire('touchend',x+sx*140,400+sy*110,id);await idle();assert.deepEqual(await state(),{left:side==='left',right:side==='right'});checks++;
 }
 await setState('closed');
 // Preserve text input and horizontally consumable code scrolling.
 for(const id of ['input','canvas','code']){
  if(id==='code')await page.$eval('#code',e=>e.scrollLeft=100);
  await fire('touchstart',20,400,id);assert.equal(await fire('touchmove',80,403,id),false);await fire('touchend',80,403,id);
  assert.deepEqual(await state(),{left:false,right:false});checks++;
 }
 // Native edge open, cancellation and finish on either edge; no release jump.
 let id=0;
 for(const side of ['left','right']){
  let token=++id;assert.equal(await native({action:'start',edge:side,id:token}),true);
  await native({action:'progress',edge:side,id:token,progress:.4});
  const jump=await page.evaluate(({id,side})=>{const el=document.querySelector(side==='left'?'#drawer':'#tools');const x=new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;window.dispatchEvent(new CustomEvent('cocloud-native-sidebar',{cancelable:true,detail:{action:'finish',id}}));return Math.abs(x-new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);},{id:token,side});
  assert.ok(jump<2);await idle();assert.equal((await state())[side],true);checks++;
  token=++id;await native({action:'start',edge:side,id:token});await native({action:'progress',id:token,progress:.6});
  assert.equal(await native({action:'finish',id:token+100}),false);await native({action:'cancel',id:token});await idle();assert.equal((await state())[side],true);checks++;
  token=++id;await native({action:'start',edge:side,id:token});await native({action:'finish',id:token});await idle();assert.deepEqual(await state(),{left:false,right:false});checks++;
 }
 // Wake conversations over an already-open browser/tools panel, before release.
 for(const source of ['touch','native']) {
  await setState('right');
  if(source==='touch') {
   await fire('touchstart',20,400);await fire('touchmove',40,402);
   assert.equal((await state()).right,false,'browser must hide at left swipe capture');
   await fire('touchmove',100,403);await fire('touchend',100,403);
  } else {
   const token=++id;assert.equal(await native({action:'start',edge:'left',id:token}),true);
   assert.equal((await state()).right,false,'browser must hide before native left progress');
   await native({action:'progress',id:token,progress:.6});await native({action:'finish',id:token});
  }
  await idle();assert.deepEqual(await state(),{left:true,right:false});checks++;
 }
 // Memory return reveals left (never toggles it shut), closes right.
 await setState('right');
 await page.evaluate(({hook,hookName})=>{
  const effects=[];
  const X={useEffectEvent:f=>f,useEffect:f=>effects.push(f)};
  const Fv={flushSync:f=>f()},Pv=Fv;
  eval(hook+';'+hookName+'(true,true,()=>{})');
  effects[0](); // Host button/shortcut changed the sidebar open prop.
 },{hook,hookName});
 assert.equal((await state()).right,false);checks++;
 await setState('right');await native({action:'show-left'});assert.deepEqual(await state(),{left:true,right:false});await native({action:'show-left'});assert.equal((await state()).left,true);checks++;
 // Cancel, reverse to origin, interrupt settlement, and reduced motion.
 for(const side of ['left','right'])for(const sign of [-1,1]){
  await setState(side);const target=side==='left'?'drawer':'tools';
  await fire('touchstart',width/2,400,target);await fire('touchmove',width/2+sign*55,404,target);await fire('touchcancel',width/2+sign*55,404,target);await idle();assert.equal((await state())[side],true);checks++;
  await fire('touchstart',width/2,400,target);await fire('touchmove',width/2+sign*55,404,target);await fire('touchmove',width/2+sign*2,401,target);await fire('touchend',width/2+sign*2,401,target);await idle();assert.equal((await state())[side],true);checks++;
 }
 await page.emulateMedia({reducedMotion:'reduce'});await setState('left');await fire('touchstart',100,400,'drawer');await fire('touchmove',160,403,'drawer');await fire('touchend',160,403,'drawer');await idle();assert.equal((await state()).left,false);checks++;
 await page.emulateMedia({reducedMotion:'no-preference'});
 // Browser native touch, scrolling and actual hit testing (not only synthetic events).
 const cdp=await page.context().newCDPSession(page);
 const touch=async(x,y,points)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(const[dx,dy]of points)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await idle();};
 for(const side of ['left','right']){
  await setState('closed');const sign=side==='left'?1:-1;
  await touch(side==='left'?20:width-20,400,[[8*sign,2],[20*sign,4],[40*sign,5],[70*sign,6]]);assert.equal((await state())[side],true);checks++;
  for(const direction of [-1,1]){
   await setState(side);await touch(width/2,400,[[8*direction,2],[20*direction,4],[45*direction,5],[70*direction,6]]);assert.deepEqual(await state(),{left:false,right:false});checks++;
  }
 }
 for(const side of ['closed','left','right'])for(const x of [20,width/2,width-20]){
  await setState(side);const target=side==='closed'?'content':side==='left'?'drawer':'tools';
  // Choose a point within the open drawer when testing its vertical content.
  const px=side==='left'?Math.min(x,width-30):side==='right'?Math.max(x,30):x;
  await page.$eval('#'+target,e=>e.scrollTop=0);
  await touch(px,500,[[5,-3],[9,-10],[14,-36],[18,-85],[22,-150]]);
  await page.waitForFunction(id=>document.getElementById(id).scrollTop>20,target);
  assert.deepEqual(await state(),{left:side==='left',right:side==='right'});checks++;
 }
 await setState('closed');await touch(width/2,400,[[20,3],[50,4],[80,5]]);assert.deepEqual(await state(),{left:false,right:false});checks++;
 assert.equal(await page.$eval('#toolbar',e=>getComputedStyle(e).transform),'none');
 await cdp.detach();await page.evaluate(()=>window.cleanup());await page.close();
}
assert.deepEqual(errors,[]);
console.log(JSON.stringify({hookName,checks,widths:[360,390,430,767],edgeOnlyOpen:true,bothDirectionsClose:true,verticalIntentPreserved:true,latestFrameFollowsFinger:true,nativeBack:true,memoryReturnLeft:true,cancelAndReversal:true}));
} finally {await browser.close();}
