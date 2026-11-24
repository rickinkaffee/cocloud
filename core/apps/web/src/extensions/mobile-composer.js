function cocloudTrackComposerViewport(win, doc) {
  const viewport = win.visualViewport;
  const keyboard = win.navigator.virtualKeyboard;
  let overlay = null;
  let shift = 0;
  function align() {
    const active = doc.activeElement;
    const next = win.matchMedia('(max-width: 767px), (pointer: coarse)').matches &&
      active?.matches('[contenteditable=true],textarea,input') &&
      active.closest('[data-chat-composer-main-surface]') &&
      active.closest('[data-chat-composer-overlay="true"]');
    if (overlay !== next) {
      overlay?.style.removeProperty('--cocloud-ime-lift');
      overlay = next || null;
      shift = 0;
    }
    if (!overlay) return;
    const visibleBottom = viewport && viewport.scale === 1 ? viewport.offsetTop + viewport.height : win.innerHeight;
    const keyboardTop = keyboard?.boundingRect.height > 0 ? keyboard.boundingRect.top : Infinity;
    const lane = active.closest('.chat-composer-lane') || overlay;
    shift = Math.max(0, Math.round(lane.getBoundingClientRect().bottom + shift - Math.min(visibleBottom, keyboardTop)));
    overlay.style.setProperty('--cocloud-ime-lift', `${-shift}px`);
  }
  doc.addEventListener('focusin', align);
  doc.addEventListener('focusout', () => queueMicrotask(align));
  win.addEventListener('resize', align);
  viewport?.addEventListener('resize', align);
  viewport?.addEventListener('scroll', align);
  keyboard?.addEventListener('geometrychange', align);
}
if (!window.__cocloudComposerViewport) {
  window.__cocloudComposerViewport = true;
  cocloudTrackComposerViewport(window, document);
}
