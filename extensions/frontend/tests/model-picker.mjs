import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const out = process.argv[2];
const compiled = readFileSync(out + '/model-picker-compiled.js', 'utf8');
let settings, requests, saved, refreshes, pendingResponse, fail, saveFailure;
let state = [], refs = [], stateIndex, refIndex, cleanup;
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: initial => { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], value => state[i] = value]; },
  useRef: initial => { const i = refIndex++; return refs[i] ??= { current: initial }; },
  useEffect: fn => { if (!cleanup) cleanup = fn(); },
};
const context = vm.createContext({ setTimeout, clearTimeout, AbortController, URLSearchParams,
  fetch: async (url, options) => {
    requests.push({ url, options });
    if (pendingResponse) await pendingResponse;
    return { ok: !fail, status: fail || 200, json: async () => fail ? {} : ({
      environmentId: 'env', instanceId: 'codex', models: [{ slug: 'gpt-6.2-sol', name: 'GPT-6.2 Sol' }, { slug: 'gpt-6.2-astra', name: 'GPT-6.2 Astra' }],
    }) };
  },
});
vm.runInContext(compiled, context);
const module = context.CocloudModelPicker;
const cardProps = {activeInstanceId:'active',model:'permitted',instanceEntries:['active','disabled','offline','other'].map(instanceId=>({instanceId, enabled:instanceId!=='disabled',driverKind:instanceId==='other'?'other':'codex'})), lockedProvider:'codex',modelOptionsByInstance:new Map(['active','disabled','offline','other'].map(id=>[id,[{slug:'permitted'},{slug:'retired',isUnavailable:true},{slug:'locked'}]])),getModelDisabledReason:(_,slug)=>slug==='locked'?'locked':null};
assert.deepEqual(Array.from(module.cardRows(cardProps,entry=>entry.instanceId!=='offline'),row=>[row.entry.instanceId,row.model.slug]),[['active','permitted']]);
assert.equal(module.cardRows({...cardProps,modelOptionsByInstance:new Map()},()=>true).length,0);
let changed;
stateIndex=0;module.card(React,{...cardProps,onInstanceModelChange:(...args)=>changed=args},entry=>entry.instanceId!=='offline').children[2].children[0][0].props.onClick();
assert.deepEqual(changed,['active','permitted']);
const allowedClaude=['claude-opus-5-5','claude-sonnet-5-5','claude-fable-5-2'];
const mixed={...cardProps,lockedProvider:undefined,instanceEntries:[cardProps.instanceEntries[0],{instanceId:'cc',driverKind:'claudeAgent',enabled:true}],modelOptionsByInstance:new Map([...cardProps.modelOptionsByInstance,['cc',[...allowedClaude,'claude-haiku-5-5','claude-future'].map(slug=>({slug}))]]),onInstanceModelChange:(id,slug)=>{mixed.activeInstanceId=id;mixed.model=slug}};
const popup=()=>{stateIndex=0;return module.card(React,mixed,()=>true)};
const family=()=>popup().children[1].children;
const visible=()=>Array.from(popup().children[2].children[0],button=>button.children[0].children[0]);
assert.deepEqual(visible(),['permitted']);
assert.deepEqual(family().map(option=>option.children[0]),['ChatGPT','Claude','Gemini']);
assert.equal(family()[2].props.disabled,true);
mixed.instanceEntries.push({instanceId:'opai',driverKind:'opencode',enabled:true}); mixed.modelOptionsByInstance.set('opai',[{slug:'opai/gemini-3.8-flash'}]);
family()[2].props.onClick(); assert.deepEqual(visible(),['opai/gemini-3.8-flash']);
mixed.instanceEntries.push({instanceId:'sydney',driverKind:'opencode',enabled:true}); mixed.modelOptionsByInstance.set('sydney',[{slug:'sydney/gemini-4-carbon'},{slug:'sydney/gemini-4-neon'}]);
assert.deepEqual(visible(),['opai/gemini-3.8-flash','sydney/gemini-4-carbon','sydney/gemini-4-neon']);
family()[1].props.onClick();assert.equal(mixed.model,'permitted');assert.deepEqual(visible(),allowedClaude);
popup().children[2].children[0][2].props.onClick();assert.equal(mixed.model,allowedClaude[2]);
family()[0].props.onClick();assert.deepEqual(visible(),['permitted']);
mixed.lockedProvider='codex';assert.equal(family()[1].props.disabled,true);
let buttons,sliderState,clicked;
context.MutationObserver=class{observe(){} disconnect(){}};
const sliderReact={...React,useRef:()=>({current:{querySelectorAll:()=>buttons}}),useState:()=>[sliderState,next=>{sliderState=next(sliderState)}],useLayoutEffect:fn=>fn()};
for(const labels of [['Low','High'],['Default','Medium','Max']]){
  buttons=labels.map((text,index)=>({textContent:text,getAttribute:()=>String(index===0),click:()=>clicked=text}));
  sliderState={labels:[],index:-1};module.effortSlider(sliderReact,null);
  const slider=module.effortSlider(sliderReact,null).children[0].children[1];
  assert.equal(slider.props.max,labels.length-1);slider.props.onChange({target:{value:labels.length-1}});assert.equal(clicked,labels.at(-1));
}
assert.equal(module.shortLabel('GPT-6.2 Sol'), '6.2 Sol');
assert.equal(module.shortLabel('gpt-6.2-astra'), '6.2 astra');
const host = () => ({ canWrite: true, getConfig: () => ({ settings }),
  save: async input => { saved.push(input); if (saveFailure) return { _tag: 'Failure' }; settings.providerInstances.codex = input.providerInstanceMutation.instance; return { _tag: 'Success' }; },
  refresh: async () => { refreshes++; return { _tag: 'Success' }; },
});
const Component = module.createLoader(React, host);
const props = { environmentId: 'env', instanceId: 'codex', driverKind: 'codex' };
const render = (value = props) => { stateIndex = refIndex = 0; return Component(value); };
const button = tree => tree.children[0];
function reset() {
  cleanup?.(); cleanup = undefined; state = []; refs = []; requests = []; saved = []; refreshes = 0; pendingResponse = undefined; fail = saveFailure = false;
  settings = { providerInstances: { codex: { driver: 'codex', displayName: 'Test', config: { homePath: '/test', customModels: ['gpt-6.1-sol'] } } } };
}
reset();
let tree = render();
assert.equal(requests.length, 0, 'opening the picker does not contact the vendor');
await button(tree).props.onClick();
assert.equal(requests.length, 1);
assert.ok(requests[0].url.includes('resource=models'));
assert.equal(requests[0].options.credentials, 'same-origin');
assert.equal(saved.length, 1);
assert.equal(settings.providerInstances.codex.config.customModels.length, 3, 'deleted models restored through persistent settings');
assert.equal(settings.providerInstances.codex.config.homePath, '/test');
assert.ok(render().children[1].children[0].includes('已加载 2 个模型'));
await button(render()).props.onClick();
assert.equal(saved.length, 1, 'repeated load deduplicates models');
reset();
let release;
pendingResponse = new Promise(resolve => release = resolve);
tree = render(); const first = button(tree).props.onClick();
await button(tree).props.onClick();
assert.equal(requests.length, 1, 'double click has only one request');
settings.providerInstances.codex.config.customModels.push('user-added-during-load');
release(); await first;
assert.ok(settings.providerInstances.codex.config.customModels.includes('user-added-during-load'));
reset(); fail = 503; await button(render()).props.onClick();
assert.equal(saved.length, 0); assert.equal(refreshes, 0);
assert.ok(render().children[1].children[0].includes('加载失败'));
fail = false; await button(render()).props.onClick(); assert.equal(saved.length, 1, 'retry succeeds');
reset(); saveFailure = true; await button(render()).props.onClick();
assert.equal(refreshes, 0); assert.ok(render().children[1].children[0].includes('未保存'));
reset(); pendingResponse = new Promise(resolve => release = resolve);
const stale = button(render()).props.onClick(); render({ ...props, instanceId: 'another' }); release(); await stale;
assert.equal(saved.length, 0, 'changing provider discards stale discovery');
reset(); pendingResponse = new Promise(resolve => release = resolve);
const closing = button(render()).props.onClick(); cleanup(); release(); await closing;
assert.equal(saved.length, 0, 'closing before discovery finishes never saves');
reset();
const readOnly = module.createLoader(React, () => ({ ...host(), canWrite: false }));
stateIndex = refIndex = 0; tree = readOnly(props); assert.equal(button(tree).props.disabled, true);
await button(tree).props.onClick(); assert.equal(requests.length, 0);
const manifest = JSON.parse(readFileSync(out + '/manifest.json'));
let variants = 0;
for (const [alias, path] of Object.entries(manifest.imports)) {
  if (!alias.includes('/ProviderModelPicker-')) continue;
  const code = readFileSync(out + '/' + path.split('/').at(-1), 'utf8');
  assert.ok(code.includes('CocloudModelPicker.createLoader'));
  assert.ok(code.includes('children:C&&e.selectedModels===void 0?[(0,Q.jsx)(Dt,'));
  assert.ok(code.includes('(0,Q.jsx)(CocloudEffortSlider,{children:e.effortColumn},e.activeInstanceId+":"+e.model)'));
  // The integration precedes the host's `var Z = ...` React initialization.
  // Execute that actual prelude with React unavailable, then render it after initialization.
  const prelude = code.slice(0, code.indexOf('import{'));
  const integration = vm.createContext({ setTimeout, clearTimeout, AbortController, URLSearchParams });
  vm.runInContext(prelude, integration);
  assert.equal(typeof integration.CocloudLoadModels, 'function');
  assert.ok(!code.includes('CocloudFamilySelect') && code.includes('children:[xe,Oe]') && code.includes('className:`cocloud-choice-layout`,children:[(0,Q.jsx)(CocloudChoiceCard,'));
  integration.Z = { ...React, useContext: () => ({ get: () => ({ settings }) }) };
  integration.v = {};
  integration.H = { updateSettings: { permissionAtom: () => ({}) }, refreshProviders: {}, configValueAtom: () => ({}) };
  integration.ne = () => async () => ({ _tag: 'Success' }); integration.M = () => true;
  reset(); stateIndex = refIndex = 0;
  assert.equal(vm.runInContext('CocloudLoadModels({environmentId:"env",instanceId:"codex",driverKind:"codex"})', integration).type, 'div');
  assert.ok(code.includes('className:`before:hidden cocloud-model-popup`'));
  assert.ok(code.includes('(0,Q.jsxs)(`details`,{"data-model-picker-effort":!0'));
  assert.ok(code.includes('if(t instanceof HTMLDetailsElement)t.open=true;'));
  assert.ok(code.includes('C&&e.selectedModels!==void 0?window.requestAnimationFrame(()=>B(`levels`)):R(!1)'));
  assert.ok(code.includes('children:[ue,ge,e.triggerSuffix,J]'), 'composer trigger must render both the current model and the live reasoning suffix');
  variants++;
}
assert.equal(variants, 3);
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const css = readFileSync(out + '/' + manifest.css.split('/').at(-1), 'utf8');
  for (const [width, height] of [[360, 300], [390, 800], [1200, 800]]) for (const dark of [false, true]) {
    await page.setViewportSize({ width, height });
    await page.setContent(`<style>:root{--border:#888;--foreground:${dark ? '#eee' : '#111'};--muted-foreground:${dark ? '#bbb' : '#555'};--popover:${dark ? '#111' : '#fff'};--ring:#4780ff}body{margin:12px}button{font:inherit}.cocloud-model-popup{--available-height:${height - 90}px} ${css}</style>
      <div class="cocloud-model-popup"><div class="cocloud-model-loader"><button class="cocloud-load-models">加载模型列表</button></div>
      <div class="cocloud-picker-body"><div data-model-picker-content>GPT-6.2 Sol<br>GPT-6.2 Astra</div>
      <details data-model-picker-effort class="cocloud-picker-effort"><summary>推理设置</summary><div style="min-height:150px"><button data-effort-level>高</button></div></details></div></div>`);
    const measured = await page.evaluate(() => {
      const popup = document.querySelector('.cocloud-model-popup').getBoundingClientRect();
      return { popup: { width: popup.width, height: popup.height, right: popup.right, bottom: popup.bottom },
        open: document.querySelector('details').open, hiddenEffort: !document.querySelector('[data-effort-level]').checkVisibility() };
    });
    assert.ok(measured.popup.width <= 300 && measured.popup.right <= width);
    assert.ok(measured.popup.height <= Math.min(272, height - 90) && measured.popup.bottom <= height);
    assert.equal(measured.open, false); assert.equal(measured.hiddenEffort, true);
    await page.locator('summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('details').evaluate(e => e.open), true);
    assert.equal(await page.locator('.cocloud-model-popup').evaluate(e => e.getBoundingClientRect().height), measured.popup.height, 'expanding reasoning cannot grow the popup out of its positioner');
    await page.locator('[data-effort-level]').focus();
    await page.locator('[data-effort-level]').click();
    await page.locator('summary').focus();
    await page.keyboard.press('Enter'); assert.equal(await page.locator('details').evaluate(e => e.open), false);
  }
} finally { await browser.close(); }
console.log('Model picker: all 3 rebuilt variants; click-only vendor load, deleted-model recovery, persistence, deduplication, concurrent edits, duplicate clicks, failures/retry, stale/unmount cancellation, permissions and compact details integration passed');
