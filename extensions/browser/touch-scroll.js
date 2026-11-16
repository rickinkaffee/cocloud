// Translate one-finger panning into Floe's existing authorized wheel path.
// Source DOM remains authoritative; never scroll the replay document locally.
let gesture;
let suppressMouseUntil = 0;
let editingIntent = false;
let motionFrame = 0;
let inertiaFrame = 0;
let pendingMotion;
let inertialSurface;
function stopMotion() {
  cancelAnimationFrame(motionFrame); cancelAnimationFrame(inertiaFrame);
  motionFrame = inertiaFrame = 0; pendingMotion = undefined; inertialSurface=undefined;
}
function sendMotion(g, dx, dy) {
  if (!g.surface.isConnected || g.surface.inert || document.hidden) return;
  g.surface.dispatchEvent(new WheelEvent('wheel', {bubbles:true,cancelable:true,clientX:g.startX,clientY:g.startY,deltaX:dx,deltaY:dy,deltaMode:0}));
}
function flushMotion() {
  motionFrame = 0;
  const p = pendingMotion; pendingMotion = undefined;
  if (p) sendMotion(p.g,p.dx,p.dy);
}
function queueMotion(g,dx,dy) {
  if (!pendingMotion) pendingMotion={g,dx:0,dy:0};
  pendingMotion.dx+=dx; pendingMotion.dy+=dy;
  if (!motionFrame) motionFrame=requestAnimationFrame(flushMotion);
}
const inputModes = new WeakMap();
function setKeyboardMode(element, enabled) {
  if (!inputModes.has(element)) inputModes.set(element, element.getAttribute('inputmode'));
  const mode = inputModes.get(element);
  if (!enabled) element.setAttribute('inputmode', 'none');
  else if (mode === null) element.removeAttribute('inputmode');
  else element.setAttribute('inputmode', mode);
}
function focusIntent(event) {
  const t = event.touches?.[0] ?? event;
  const surface = surfaceFor(event.target);
  if (!surface) { editingIntent = false; gesture=undefined;stopMotion();return; }
  if (event.target.closest('.floe-input-proxy')) { editingIntent = true; setKeyboardMode(event.target, !event.target.readOnly); return; }
  let hit;
  for (const frame of surface.parentElement.querySelectorAll('iframe')) {
    const r = frame.getBoundingClientRect();
    if (t.clientX < r.left || t.clientX > r.right || t.clientY < r.top || t.clientY > r.bottom) continue;
    try { hit = frame.contentDocument?.elementFromPoint((t.clientX-r.left)*frame.clientWidth/r.width, (t.clientY-r.top)*frame.clientHeight/r.height); } catch {}
    if (hit) break;
  }
  editingIntent = !!hit?.closest('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,[contenteditable=true],[contenteditable=plaintext-only]');
  for (const input of surface.parentElement.querySelectorAll('.floe-input-proxy,.floe-input-sink')) setKeyboardMode(input, editingIntent && !input.readOnly);
  if (!editingIntent && document.activeElement?.matches('.floe-input-proxy,.floe-input-sink')) document.activeElement.blur();
}
document.addEventListener('pointerdown', focusIntent, true);
document.addEventListener('touchstart', focusIntent, {capture:true,passive:true});
document.addEventListener('focusin', event => {
  if (!event.target.matches?.('.floe-input-proxy,.floe-input-sink')) return;
  setKeyboardMode(event.target, editingIntent && !event.target.readOnly);
  if (!editingIntent && event.target.matches('.floe-input-proxy')) event.target.blur();
}, true);
const keyboardObserver = new MutationObserver(records => {
  for (const record of records) for (const node of record.addedNodes) {
    if (!(node instanceof Element)) continue;
    const inputs = node.matches('.floe-input-sink,.floe-input-proxy') ? [node] : node.querySelectorAll('.floe-input-sink,.floe-input-proxy');
    for (const input of inputs) if (!inputModes.has(input)) setKeyboardMode(input, editingIntent && !input.readOnly);
  }
});
keyboardObserver.observe(document.documentElement,{childList:true,subtree:true});
for (const input of document.querySelectorAll('.floe-input-sink,.floe-input-proxy')) setKeyboardMode(input,false);
const motionStateObserver = new MutationObserver(() => {
  const surface=gesture?.surface ?? pendingMotion?.g.surface ?? inertialSurface;
  if (surface?.inert) {gesture=undefined;stopMotion();}
  if (document.querySelector('.floe-viewport [aria-label=Disconnected]')) stopMotion();
});
motionStateObserver.observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:['inert']});
const surfaceFor = target => target instanceof Element ? target.closest('.floe-input-surface') : null;
document.addEventListener('touchstart', event => {
  stopMotion();
  gesture = undefined;
  if (event.touches.length !== 1) return;
  const surface = surfaceFor(event.target);
  if (!surface || surface.inert || event.target.closest('.floe-input-proxy')) return;
  const t = event.touches[0];
  gesture = { surface, id: t.identifier, startX: t.clientX, startY: t.clientY, x: t.clientX, y: t.clientY, panning: false, time:performance.now(), vx:0, vy:0 };
}, { passive: true });
document.addEventListener('touchmove', event => {
  const g = gesture;
  if (!g) return;
  if (event.touches.length !== 1 || !g.surface.isConnected || g.surface.inert) { gesture = undefined;stopMotion();return; }
  const t = event.touches[0];
  if (t.identifier !== g.id) { gesture = undefined; return; }
  if (!g.panning && Math.hypot(t.clientX-g.startX, t.clientY-g.startY) < 8) return;
  g.panning = true;
  event.preventDefault();
  suppressMouseUntil = performance.now() + 800;
  const dx = g.x - t.clientX, dy = g.y - t.clientY;
  const now=performance.now(), dt=Math.max(8,now-g.time);
  g.vx=dx/dt; g.vy=dy/dt; g.time=now;
  g.x = t.clientX; g.y = t.clientY;
  queueMotion(g,dx,dy);
}, { passive: false });
const finish = event => {
  if (event.type==='touchcancel') {gesture=undefined;stopMotion();return;}
  if (gesture?.panning) { if (event.cancelable) event.preventDefault(); suppressMouseUntil = performance.now() + 800; }
  if (motionFrame) {cancelAnimationFrame(motionFrame);flushMotion();}
  const g=gesture;
  gesture = undefined;
  if (event.type!=='touchend' || !g?.panning || performance.now()-g.time>80) return;
  let vx=Math.max(-2.5,Math.min(2.5,g.vx)), vy=Math.max(-2.5,Math.min(2.5,g.vy));
  let previous=performance.now(), start=previous;
  inertialSurface=g.surface;
  const step=now=>{
    if (!g.surface.isConnected || g.surface.inert || document.hidden || now-start>650) {inertiaFrame=0;return;}
    const dt=Math.min(32,now-previous); previous=now;
    const decay=Math.exp(-dt/140); vx*=decay;vy*=decay;
    if (Math.hypot(vx,vy)<0.04) {inertiaFrame=0;return;}
    sendMotion(g,vx*dt,vy*dt);inertiaFrame=requestAnimationFrame(step);
  };
  inertiaFrame=requestAnimationFrame(step);
};
document.addEventListener('touchend', finish, { passive: false });
document.addEventListener('touchcancel', finish, { passive: false });
window.addEventListener('blur', () => { gesture = undefined; stopMotion(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) {gesture = undefined;stopMotion();} });
document.addEventListener('pointerdown',stopMotion,true);
document.addEventListener('keydown',stopMotion,true);
for (const type of ['mousedown', 'mouseup', 'click']) {
  document.addEventListener(type, event => {
    if (performance.now() < suppressMouseUntil && surfaceFor(event.target) && event.sourceCapabilities?.firesTouchEvents !== false) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
}

// Android IMEs can emit beforeinput deletion with keyCode 229/Unidentified
// instead of a usable Backspace key. Reuse Floe's fenced keyboard path.
const composingInputs = new WeakSet();
let physicalDelete;
const editableInput = target => target instanceof Element &&
  target.matches('input.floe-input-proxy, textarea.floe-input-proxy, textarea.floe-input-sink, .floe-input-surface input, .floe-input-surface textarea');
document.addEventListener('compositionstart', event => {
  if (editableInput(event.target)) composingInputs.add(event.target);
}, true);
document.addEventListener('compositionend', event => {
  if (event.target instanceof Element) composingInputs.delete(event.target);
}, true);
document.addEventListener('keydown', event => {
  if (editableInput(event.target) && event.isTrusted && !event.isComposing &&
      !composingInputs.has(event.target) && ['Backspace', 'Delete'].includes(event.key))
    physicalDelete = { target: event.target, key: event.key, at: performance.now() };
}, true);
document.addEventListener('beforeinput', event => {
  const target = event.target;
  if (!editableInput(target) || target.readOnly || target.disabled ||
      event.isComposing || composingInputs.has(target)) return;
  const deletion = {
    deleteContentBackward: ['Backspace', false],
    deleteContentForward: ['Delete', false],
    deleteWordBackward: ['Backspace', true],
    deleteWordForward: ['Delete', true],
  }[event.inputType];
  if (!deletion) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const [key, word] = deletion;
  if (physicalDelete?.target === target && physicalDelete.key === key &&
      performance.now() - physicalDelete.at < 150) { physicalDelete = undefined; return; }
  physicalDelete = undefined;
  for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, {
    key, code: key, bubbles: true, cancelable: true, ctrlKey: word,
    keyCode: key === 'Backspace' ? 8 : 46, which: key === 'Backspace' ? 8 : 46,
  }));
}, true);
