(() => {
  if (window.__t3MobileComposerFocusGuard) return;
  window.__t3MobileComposerFocusGuard = true;
  const mobile = () => matchMedia('(max-width: 767px), (pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const editable = element => element instanceof HTMLElement && (element.isContentEditable || element.matches('textarea, input:not([type=file]):not([type=hidden])'));
  const composer = element => editable(element) && !!element.closest('[data-testid="composer-editor"], .composer-tiptap, [data-chat-composer-main-surface]');
  let intent = null;
  const allowed = element => intent?.path === location.pathname && (document.activeElement === element || performance.now() - intent.time < 1200);
  document.addEventListener('pointerdown', event => {
    if (!mobile() || !event.isTrusted || !(event.target instanceof Element)) return;
    const surface = event.target.closest('[data-chat-composer-main-surface], [data-chat-composer-mobile-collapsed], [data-testid="composer-editor"], .composer-tiptap');
    const control = event.target.closest('button, a, [role="button"]');
    if (surface && (!control || control.closest('[data-chat-composer-mobile-collapsed]'))) {
      intent = { path: location.pathname, time: performance.now() };
    } else {
      intent = null;
      if (composer(document.activeElement)) document.activeElement.blur();
    }
  }, true);
  const originalFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...args) {
    if (mobile() && composer(this) && !allowed(this)) return;
    return originalFocus.apply(this, args);
  };
  document.addEventListener('focusin', event => {
    if (mobile() && composer(event.target) && !allowed(event.target)) event.target.blur();
  }, true);
})();
