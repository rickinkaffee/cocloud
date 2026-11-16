(() => {
  const mobile = () => matchMedia('(max-width: 767px), (pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  document.addEventListener('pointerdown', event => {
    if (!mobile() || !event.isTrusted || !(event.target instanceof Element)) return;
    const surface = event.target.closest('[data-chat-composer-main-surface], [data-chat-composer-mobile-collapsed], [data-testid="composer-editor"]');
    const control = event.target.closest('button, a, [role="button"]');
    if (surface && (!control || control.closest('[data-chat-composer-mobile-collapsed]'))) {
      window.__t3ComposerFocusIntent = { path: location.pathname, time: performance.now() };
    } else {
      window.__t3ComposerFocusIntent = null;
    }
  }, true);
})();
