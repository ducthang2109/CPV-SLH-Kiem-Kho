// Lưu trữ offline bằng IndexedDB: dữ liệu tồn kho đã tải, phiên kiểm kê, file chờ đồng bộ.
const DB = (function () {
  const NAME = 'kiem-kho';
  const VERSION = 1;
  const STORES = ['datasets', 'sessions', 'outbox'];
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const req = fn(s);
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    get: (store, id) => tx(store, 'readonly', s => s.get(id)),
    all: (store) => tx(store, 'readonly', s => s.getAll()),
    put: (store, obj) => tx(store, 'readwrite', s => s.put(obj)),
    del: (store, id) => tx(store, 'readwrite', s => s.delete(id))
  };
})();
