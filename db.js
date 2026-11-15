// Almacenamiento local en IndexedDB. Todo se queda en el dispositivo.
const DB_NAME = 'hilo';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('habits')) db.createObjectStore('habits', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('checks')) db.createObjectStore('checks', { keyPath: ['habitId', 'date'] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function write(stores, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    fn(tx);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export async function loadAll() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['habits', 'checks']);
    const h = tx.objectStore('habits').getAll();
    const c = tx.objectStore('checks').getAll();
    tx.oncomplete = () => resolve({ habits: h.result, checks: c.result });
    tx.onerror = () => reject(tx.error);
  });
}

export const putHabit = (habit) => write(['habits'], (tx) => tx.objectStore('habits').put(habit));

export const deleteHabit = (id) => write(['habits', 'checks'], (tx) => {
  tx.objectStore('habits').delete(id);
  tx.objectStore('checks').delete(IDBKeyRange.bound([id, ''], [id, '￿']));
});

export const addCheck = (habitId, date) => write(['checks'], (tx) => tx.objectStore('checks').put({ habitId, date }));

export const removeCheck = (habitId, date) => write(['checks'], (tx) => tx.objectStore('checks').delete([habitId, date]));

export const replaceAll = (habits, checks) => write(['habits', 'checks'], (tx) => {
  const hs = tx.objectStore('habits');
  const cs = tx.objectStore('checks');
  hs.clear();
  cs.clear();
  habits.forEach((h) => hs.put(h));
  checks.forEach((c) => cs.put({ habitId: c.habitId, date: c.date }));
});
