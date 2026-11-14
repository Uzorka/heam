// The outbox: clock-ins saved on the phone (IndexedDB) until they are sent.
// Survives closing the app, restarting the phone and having no signal.

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('pinga', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('outbox', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function run(mode, fn) {
  const tx = (await db()).transaction('outbox', mode);
  const req = fn(tx.objectStore('outbox'));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const outbox = {
  all: () => run('readonly', (s) => s.getAll()).then((rows) => rows.sort((a, b) => a.happened_at.localeCompare(b.happened_at))),
  put: (rec) => run('readwrite', (s) => s.put(rec)),
  remove: (id) => run('readwrite', (s) => s.delete(id)),
};
