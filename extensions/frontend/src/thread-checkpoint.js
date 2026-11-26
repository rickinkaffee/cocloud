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
async function cocloudLoadCheckpoint() {
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
