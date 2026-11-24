let cocloudBootCheckpoint = null;
let cocloudCheckpointDb;
let cocloudWrittenPath;
function cocloudMobileBrowser() {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);
}
function cocloudDb() {
  return cocloudCheckpointDb ??= new Promise(resolve => {
    try {
      const request = indexedDB.open('cocloud-navigation', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('navigation');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function cocloudWriteCheckpoint(path) {
  if (!cocloudMobileBrowser() || cocloudWrittenPath === path) return;
  cocloudWrittenPath = path;
  try {
    const db = await cocloudDb();
    if (!db) return;
    const transaction = db.transaction('navigation', 'readwrite', {durability:'strict'});
    transaction.onabort = () => { if (cocloudWrittenPath === path) cocloudWrittenPath = null; };
    transaction.objectStore('navigation').put(path, 'last');
  } catch { cocloudWrittenPath = null; }
}
export async function cocloudLoadCheckpoint() {
  if (!cocloudMobileBrowser()) return;
  const dbReady = cocloudDb();
  if (location.search || location.hash || !(location.pathname === '/' || location.pathname.startsWith('/draft/'))) return;
  let timer;
  try {
    cocloudBootCheckpoint = await Promise.race([new Promise(resolve => { timer = setTimeout(resolve, 900); }), dbReady.then(db => new Promise(resolve => {
      if (!db) return resolve(null);
      const request = db.transaction('navigation').objectStore('navigation').get('last');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    }))]);
  } catch {} finally { clearTimeout(timer); }
}

export function cocloudResumeThread(history, createRouter) {
  const key = 'cocloud:last-conversation:v1';
  const validPath = path => typeof path === 'string' && /^\/(?:[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}|draft)\/(?:[\w:~-]|%[\da-f]{2})+$/i.test(path);
  try {
    const entry = history.location.href;
    const plainDraft = validPath(entry) && entry.startsWith('/draft/');
    const mobileEntry = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);
    const coldDraft = plainDraft && mobileEntry && !document.referrer;
    if (entry === '/' || coldDraft) {
      const saved = cocloudBootCheckpoint || localStorage.getItem(key);
      if (validPath(saved) && saved !== entry && (!coldDraft || !saved.startsWith('/draft/'))) history.replace(saved);
    }
  } catch {}
  const router = createRouter();
  if (document.visibilityState === 'visible' && validPath(history.location.href)) cocloudWriteCheckpoint(history.location.href);
  let suspended = null;
  let wasVisible = document.visibilityState === 'visible';
  function suspend() {
    if (!wasVisible) return;
    wasVisible = false;
    const path = history.location.href.split(/[?#]/)[0];
    suspended = validPath(path) ? path : null;
    if (suspended) cocloudWriteCheckpoint(suspended);
    try { if (suspended) localStorage.setItem(key, suspended); } catch {}
  }
  function resume() {
    if (document.visibilityState !== 'visible') return;
    wasVisible = true;
    const previous = suspended;
    suspended = null;
    const current = history.location.href;
    if (previous && previous !== current && (current === '/' || /^\/draft\/[\w:-]+$/.test(current))) {
      history.replace(previous);
      return;
    }
    remember();
  }
  function remember() {
    if (document.visibilityState !== 'visible') return;
    const match = router.state.matches.at(-1);
    const path = router.state.location.pathname;
    if (match?.routeId !== '/_chat/$environmentId/$threadId' && match?.routeId !== '/_chat/draft/$draftId') return;
    if (history.location.href.split(/[?#]/)[0] !== path) return;
    if (validPath(path)) cocloudWriteCheckpoint(path);
    try {
      if (validPath(path)) localStorage.setItem(key, path);
    } catch {}
  }
  router.subscribe('onResolved', remember);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' ? suspend() : resume());
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', resume);
  window.addEventListener('focus', resume);
  return router;
}
