/* Native WebView download transport. No JS-to-Java interface or filesystem access. */
(() => {
  if (window.__cocloudDownloadsV1) return;
  const MAX = 64 * 1024 * 1024, CHUNK = 192 * 1024;
  const captured = new Map(), jobs = new Map();
  function allowed(url) {
    return typeof url === 'string' && url.startsWith('blob:' + location.origin + '/');
  }
  function remember(anchor) {
    if (!allowed(anchor.href)) return;
    const url = anchor.href;
    // Start the fetch synchronously, before the caller can revoke the object URL.
    const entry = { name: anchor.download || '', blob: fetch(url).then(r => r.blob()) };
    entry.blob.catch(() => {});
    captured.set(url, entry);
    while (captured.size > 4) captured.delete(captured.keys().next().value);
    setTimeout(() => { if (captured.get(url) === entry) captured.delete(url); }, 30000);
  }
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { remember(this); return originalClick.call(this); };
  document.addEventListener('click', e => { const a = e.target.closest?.('a'); if (a) remember(a); }, true);
  window.__cocloudDownloadsV1 = {
    begin(id, url) {
      if (!allowed(url)) throw Error('Invalid blob origin');
      if (jobs.size >= 2) throw Error('Too many downloads');
      const entry = captured.get(url);
      captured.delete(url);
      const job = { phase: 'loading', name: entry?.name || '' };
      jobs.set(id, job);
      (entry?.blob || fetch(url).then(r => r.blob())).then(blob => {
        if (blob.size > MAX) throw Error('文件超过 64 MB，请使用浏览器下载');
        job.blob = blob; job.size = blob.size; job.mime = blob.type; job.phase = 'ready';
      }).catch(e => { job.phase = 'error'; job.error = String(e.message || e); });
      return true;
    },
    info(id) {
      const j = jobs.get(id);
      return j ? { phase: j.phase, name: j.name, size: j.size, mime: j.mime, error: j.error } : { phase: 'error', error: '下载已取消' };
    },
    pull(id, offset) {
      const j = jobs.get(id);
      if (!j || j.phase !== 'ready' || !Number.isInteger(offset) || offset < 0 || offset >= j.size)
        return { error: 'Invalid download offset' };
      if (!j.chunk || j.chunk.offset !== offset) {
        const c = j.chunk = { offset, pending: true };
        j.blob.slice(offset, offset + CHUNK).arrayBuffer().then(buffer => {
          const bytes = new Uint8Array(buffer);
          let text = '';
          for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
          c.data = btoa(text); c.pending = false;
        }).catch(e => { c.error = String(e.message || e); c.pending = false; });
      }
      return j.chunk;
    },
    cancel(id) { jobs.delete(id); }
  };
})();
