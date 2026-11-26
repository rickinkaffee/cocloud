import { useEffect, useEffectEvent } from 'react';
import { flushSync } from 'react-dom';
import { createGesture, createAnimation, getTimeGivenProgression } from '@ionic/core/components';
import type { Animation as IonicAnimation } from '@ionic/core';

type Side = 'left' | 'right';
const DRAWER = '[data-sidebar="sidebar"][data-mobile="true"][data-side="left"]';
const EDGE_WIDTH = 36;
const ANDROID_BROWSER_EDGE_WIDTH = 72;
const TOOLS = '[data-workbench-tools][data-slot=sheet-popup]';
const hideBrowserPanel = () => window.dispatchEvent(new CustomEvent('cocloud-tools-panel', {
  cancelable: true, detail: {action: 'close'},
}));
const clamp = (x: number, max = 1) => Math.max(0, Math.min(max, x));
const signed = (side: Side, x: number) => side === 'left' ? x : -x;

type Drag = {
  side: Side; drawer: HTMLElement; shade: HTMLElement | null;
  width: number; originX: number; originY: number; latestX: number; motionSign: number; start: number; position: number;
  open: boolean; captured: boolean; native: boolean; interrupted: boolean; nativeId?: number;
  target: Element; animation: IonicAnimation | null; lastMove: number; lastX: number; velocity: number;
};

/** Ionic owns pan recognition, velocity sampling, frame scheduling and animation.
 * This adapter only connects the existing portaled React panels and native back. */
export function useWorkbenchSidebarSwipe(enabled: boolean, open: boolean, setOpen: (value: boolean) => void) {
  const currentOpen = useEffectEvent(() => open);
  const commitLeft = useEffectEvent((next: boolean) => {
    if (next) hideBrowserPanel();
    setOpen(next);
  });
  // Also cover the host's sidebar button and keyboard shortcut.
  useEffect(() => { if (enabled && open) hideBrowserPanel(); }, [enabled, open]);
  useEffect(() => {
    if (!enabled) return;
    try {
      if (sessionStorage.getItem('cocloud:memory-open-sidebar') === '1') {
        sessionStorage.removeItem('cocloud:memory-open-sidebar');
        commitLeft(true);
      }
    } catch {}

    const root = document.documentElement;
    const nativeOnly = navigator.userAgent.includes('CocloudAndroid/');
    const edgeWidth = /Android/i.test(navigator.userAgent) ? ANDROID_BROWSER_EDGE_WIDTH : EDGE_WIDTH;
    root.dataset.workbenchGestureEngine = 'ionic-9.0.11';
    let drag: Drag | null = null;
    let settling: Drag | null = null;
    let settleTarget = false;
    let settlingFrame = 0;
    let suppressClick = false;
    let aborting = false;
    let disposed = false;
    const drawerFor = (side: Side) => document.querySelector<HTMLElement>(side === 'left' ? DRAWER : TOOLS);
    const shadeFor = (side: Side) => document.querySelector<HTMLElement>(`[data-workbench-${side === 'left' ? 'sidebar' : 'tools'}-backdrop]`);
    const mark = (side: Side, value: string) => {
      root.dataset[side === 'left' ? 'workbenchSidebarMotion' : 'workbenchToolsMotion'] = value;
    };
    const commitPanel = (side: Side, value: boolean) => {
      if (side === 'left') { commitLeft(value); return true; }
      return !window.dispatchEvent(new CustomEvent('cocloud-tools-panel', {cancelable: true, detail: {action: value ? 'open' : 'close'}}));
    };
    const visible = (el: Element) => {
      if (el.closest('[hidden],[inert],[aria-hidden="true"],[data-closed]')) return false;
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight &&
        style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.01;
    };
    const blocked = () => [...document.querySelectorAll('[role="dialog"],[role="menu"],[role="alertdialog"]')]
      .some(el => el !== drawerFor('left') && el !== drawerFor('right') && visible(el));
    const clean = (state: Drag) => {
      state.animation?.destroy(); state.animation = null;
      state.drawer.style.removeProperty('transform'); state.drawer.style.removeProperty('--workbench-sidebar-x');
      state.shade?.style.removeProperty('opacity'); state.shade?.style.removeProperty('--workbench-sidebar-progress');
      delete root.dataset[state.side === 'left' ? 'workbenchSidebarMotion' : 'workbenchToolsMotion'];
    };
    const freeze = (state: Drag) => {
      // Read the presentation, not the old endpoint, when re-grabbing a settle.
      const matrix = new DOMMatrixReadOnly(getComputedStyle(state.drawer).transform);
      const position = clamp(state.width + -state.motionSign * matrix.m41, state.width);
      state.drawer.style.transform = `translate3d(${state.motionSign * (state.width - position)}px,0,0)`;
      if (state.shade) state.shade.style.opacity = String(position / state.width);
      state.animation?.destroy(); state.animation = null;
      state.position = position;
      return position;
    };
    const makeAnimation = (state: Drag) => {
      const animation = createAnimation('cocloud-panel').addElement(state.drawer).duration(260).easing('linear').fill('both')
        .fromTo('transform', `translate3d(${state.motionSign * state.width}px,0,0)`, 'translate3d(0px,0,0)');
      if (state.shade) animation.addAnimation(createAnimation().addElement(state.shade).fromTo('opacity', '0', '1'));
      state.animation = animation;
      animation.progressStart(true, state.position / state.width);
    };
    const paint = (state: Drag, x: number) => {
      state.position = clamp(state.start - state.motionSign * (x - state.originX), state.width);
      state.animation?.progressStep(state.position / state.width);
    };
    const settle = (state: Drag, target: boolean, velocity = 0) => {
      if (settlingFrame) cancelAnimationFrame(settlingFrame);
      suppressClick = true; drag = null; settling = state; settleTarget = target;
      mark(state.side, 'settling');
      // Keep the endpoint after Ionic removes its animation during cleanup.
      state.drawer.style.transform = `translate3d(${state.motionSign * (target ? 0 : state.width)}px,0,0)`;
      if (state.shade) state.shade.style.opacity = target ? '1' : '0';
      const finish = () => {
        if (disposed || settling !== state) return;
        flushSync(() => commitPanel(state.side, target));
        settlingFrame = requestAnimationFrame(() => {
          settlingFrame = requestAnimationFrame(() => {
            settlingFrame = 0;
            if (settling !== state) return;
            settling = null; clean(state);
          });
        });
      };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs((target ? state.width : 0) - state.position) < 1) {
        finish(); return;
      }
      // Ionic progressEnd continues the paused interactive animation to an endpoint.
      const progress = state.position / state.width;
      // Map linear drag progress onto the settle curve, as Ionic Menu does,
      // so lifting a finger does not jump to an already eased position.
      const easedTime = getTimeGivenProgression([0, 0], [0.4, 0], [0.6, 1], [1, 1], progress)[0] ?? progress;
      state.animation!.easing('cubic-bezier(0.4,0,0.6,1)').onFinish(finish, {oneTimeCallback: true})
        .progressEnd(target ? 1 : 0, easedTime, Math.max(160, 280 - Math.abs(velocity) * 60));
    };
    const cancel = () => {
      const state = drag;
      if (!state) return;
      if (state.captured) settle(state, state.open);
      else if (state.interrupted) { makeAnimation(state); settle(state, state.open); }
      else { drag = null; if (state.animation) clean(state); }
    };
    const prepare = (x: number, target: Element, native = false, preferred?: Side, y = 0) => {
      if (drag) cancel();
      if (blocked() || (!native && target.closest('input,textarea,select,[contenteditable="true"],canvas,[data-no-sidebar-swipe]'))) return false;
      const interrupted = settling !== null;
      const interruptedSign = settling?.motionSign;
      let active: Side | null = settling?.side ?? (currentOpen() ? 'left' : drawerFor('right')?.hasAttribute('data-open') ? 'right' : null);
      const edge: Side | null = x <= edgeWidth ? 'left' : x >= innerWidth - edgeWidth ? 'right' : null;
      // The left edge always reaches conversations, including over an open browser.
      if (!settling && active === 'right' && (preferred ?? edge) === 'left') active = null;
      if (!active && !native && !edge) return false;
      const side = active ?? preferred ?? edge ?? 'left';
      let drawer = drawerFor(side) ?? drawerFor('left');
      if (!drawer) return false;
      let start = active ? drawer.getBoundingClientRect().width : 0;
      const opened = settling ? settleTarget : active !== null;
      if (settling) {
        if (settlingFrame) cancelAnimationFrame(settlingFrame);
        settlingFrame = 0;
        start = freeze(settling); drawer = settling.drawer;
        mark(settling.side, 'dragging'); settling = null;
      }
      const width = drawer.getBoundingClientRect().width || Math.min(400, innerWidth - 24);
      suppressClick = false;
      drag = {side, drawer, shade: shadeFor(side), width, originX: x, originY: y, latestX: x, motionSign: interruptedSign ?? (side === 'left' ? -1 : 1), start, position: start,
        open: opened, captured: false, native, interrupted, target, animation: null, lastMove: 0, lastX: x, velocity: 0};
      return true;
    };
    const capture = (state: Drag, x: number) => {
      const dx = x - state.originX;
      const side = state.side;
      if (!state.open && !state.interrupted && !state.native && signed(side, dx) <= 0) { drag = null; return false; }
      // An open panel follows either horizontal direction off screen. Reversing
      // before release moves it back toward its original position.
      if (state.open && !state.native && !state.interrupted) state.motionSign = dx >= 0 ? 1 : -1;
      // Horizontally scrollable content keeps gestures in a consumable direction.
      if (!state.open && !state.native) {
        for (let node: Element | null = state.target; node && node !== document.body; node = node.parentElement) {
          if (node.scrollWidth > node.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(node).overflowX) &&
              (dx > 0 ? node.scrollLeft > 1 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1)) {
            drag = null; return false;
          }
        }
      }
      state.side = side;
      if (side === 'left' && !state.open) flushSync(() => hideBrowserPanel());
      if (side === 'right' && !drawerFor(side)) {
        let accepted = false; flushSync(() => { accepted = commitPanel(side, true); });
        if (!accepted) { drag = null; return false; }
      }
      const drawer = drawerFor(side);
      if (!drawer) { drag = null; return false; }
      state.drawer = drawer; state.shade = shadeFor(side);
      state.width = drawer.getBoundingClientRect().width || Math.min(400, innerWidth - 24);
      state.start = clamp(state.start, state.width); state.position = state.start;
      state.captured = true;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches('input,textarea,[contenteditable="true"]')) focused.blur();
      mark(side, 'dragging'); makeAnimation(state); paint(state, x); return true;
    };
    // The host uses portaled Base UI dialogs. Capture-phase registration prevents
    // their bubble-phase scroll handlers from swallowing events before Ionic sees them.
    const surface = {
      ownerDocument: document,
      addEventListener(type: string, listener: EventListener, options: AddEventListenerOptions) {
        document.addEventListener(type, listener, {...options, capture: true});
      },
      removeEventListener(type: string, listener: EventListener, options: EventListenerOptions) {
        document.removeEventListener(type, listener, {...options, capture: true});
      },
    };
    const gesture = nativeOnly ? null : createGesture({
      el: surface as unknown as HTMLElement, gestureName: 'cocloud-workbench-panels', gesturePriority: 40,
      direction: 'x', threshold: 14, maxAngle: 30, passive: false,
      canStart(detail) {
        const event = detail.event as TouchEvent;
        return !drag?.native && (!event.touches || event.touches.length === 1) &&
          event.target instanceof Element && prepare(detail.currentX, event.target, false, undefined, detail.currentY);
      },
      onStart(detail) {
        const state = drag;
        if (!state || !detail.event.cancelable) { cancel(); return; }
        if (capture(state, detail.currentX)) { detail.event.preventDefault(); detail.event.stopPropagation(); state.lastMove = detail.currentTime; state.lastX = detail.currentX; state.velocity = detail.velocityX; }
      },
      onMove(detail) {
        if (drag?.captured && !drag.native) { paint(drag, drag.latestX); drag.lastMove = detail.currentTime; drag.lastX = detail.currentX; drag.velocity = detail.velocityX; }
      },
      onEnd(detail) {
        const state = drag;
        if (!state || state.native) return;
        if (!state.captured) { cancel(); return; }
        if (aborting || detail.event?.type === 'touchcancel') { cancel(); return; }
        paint(state, detail.currentX);
        // touchend often repeats the last coordinate. Do not treat lifting a
        // finger as a fresh zero-speed sample; retain Ionic's last movement speed.
        const releaseVelocity = Math.abs(detail.currentX - state.lastX) < 0.5 ? state.velocity : detail.velocityX;
        const velocity = detail.currentTime - state.lastMove > 100 ? 0 : -state.motionSign * releaseVelocity;
        const delta = state.position - state.start;
        // Ionic's menu uses recent velocity or half-panel travel. Keep a shorter
        // deliberate close for this wide workbench drawer; taps never capture.
        const target = Math.abs(velocity) >= 0.2 && Math.abs(delta) >= 14 ? velocity > 0
          : state.open ? !(delta <= -24) : state.position >= 32;
        if (detail.event?.cancelable) detail.event.preventDefault();
        settle(state, target, velocity);
      },
      notCaptured() { cancel(); },
    });
    // Cancel browser scrolling synchronously after Ionic capture, not inside its
    // queued animation frame. A delayed preventDefault is too late in WebView.
    const ownMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) { cancel(); return; }
      if (!drag || drag.native) return;
      const touch = event.touches[0];
      drag.latestX = touch.clientX;
      if (!drag.captured) {
        const dx = Math.abs(touch.clientX - drag.originX), dy = Math.abs(touch.clientY - drag.originY);
        // Decide vertical intent before horizontal capture. Never try to steal
        // an already scrolling contact later when the thumb turns sideways.
        if (dy >= 8 && dy >= dx * 0.8) cancel();
        return;
      }
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault(); event.stopPropagation();
    };
    const multiTouch = (event: TouchEvent) => { if (event.touches.length > 1) cancel(); };
    if (gesture) {
      document.addEventListener('touchmove', ownMove, {capture: true, passive: false});
      document.addEventListener('touchstart', multiTouch, {capture: true, passive: true});
      gesture.enable();
    }
    const abort = () => {
      aborting = true; gesture?.enable(false); cancel(); aborting = false;
      if (settling) {
        const state = settling; settling = null;
        flushSync(() => commitPanel(state.side, settleTarget)); clean(state);
      }
      if (settlingFrame) cancelAnimationFrame(settlingFrame); settlingFrame = 0;
      gesture?.enable();
    };
    const nativeSidebar = (event: Event) => {
      const info = (event as CustomEvent).detail ?? {};
      if (info.action === 'show-left') {
        event.preventDefault(); abort();
        if (drawerFor('right')?.hasAttribute('data-open')) commitPanel('right', false);
        commitPanel('left', true); return;
      }
      if (info.action === 'start') {
        abort();
        const side: Side = info.edge === 'right' ? 'right' : 'left';
        if (!prepare(0, document.body, true, side)) return;
        const state = drag!; state.nativeId = info.id;
        // Existing open panels close regardless of which system edge started.
        const direction = state.open ? -1 : 1;
        if (!capture(state, signed(state.side, direction * 10))) return;
        state.originX = 0; state.position = state.start;
        state.animation!.progressStep(state.position / state.width);
        event.preventDefault(); return;
      }
      if (['progress','cancel','finish'].includes(info.action)) {
        const state = drag;
        if (!state?.native || state.nativeId !== info.id) return;
        event.preventDefault();
        if (info.action === 'cancel') { settle(state, state.open); return; }
        if (info.action === 'finish') { settle(state, !state.open); return; }
        state.position = state.start + ((state.open ? 0 : state.width) - state.start) * clamp(Number(info.progress) || 0);
        state.animation!.progressStep(state.position / state.width); return;
      }
      if (blocked()) return;
      const left = currentOpen(), right = !!drawerFor('right')?.hasAttribute('data-open');
      if (info.action === 'back' && !left && !right) return;
      if (!['back','open','close'].includes(info.action)) return;
      event.preventDefault(); abort();
      if (left) commitPanel('left', false);
      else if (right) commitPanel('right', false);
      else commitPanel(info.action === 'open' ? 'left' : 'right', true);
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
    };
    const visibility = () => { if (document.hidden) abort(); };
    let width = innerWidth;
    const resize = () => { if (width !== innerWidth) { width = innerWidth; abort(); } };
    if (gesture) document.addEventListener('click', click, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('resize', resize);
    window.addEventListener('cocloud-native-sidebar', nativeSidebar);
    return () => {
      disposed = true; gesture?.destroy();
      if (settlingFrame) cancelAnimationFrame(settlingFrame);
      if (drag) clean(drag); if (settling) clean(settling);
      drag = settling = null;
      delete root.dataset.workbenchGestureEngine;
      if (gesture) {
        document.removeEventListener('touchmove', ownMove, true);
        document.removeEventListener('touchstart', multiTouch, true);
        document.removeEventListener('click', click, true);
      }
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', resize);
      window.removeEventListener('cocloud-native-sidebar', nativeSidebar);
    };
  }, [enabled]);
}
