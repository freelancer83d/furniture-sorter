// Minimal IndexedDB wrapper — no external deps.
// Two stores: "items" (keyed by id) and "meta" (categories list + settings).

const DB_NAME = "furniture-sorter";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) {
        db.createObjectStore("items", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

// Bulk write items in chunks so 70k rows don't block the UI thread badly.
export async function saveAllItems(items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("items", "readwrite");
    const store = t.objectStore("items");
    store.clear();
    for (const it of items) store.put(it);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// Update just the category of many items (used on every move) — fast, keyed writes.
export async function updateCategories(idToCat) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("items", "readwrite");
    const store = t.objectStore("items");
    idToCat.forEach((cat, id) => {
      const g = store.get(id);
      g.onsuccess = () => {
        const rec = g.result;
        if (rec) { rec.category = cat; store.put(rec); }
      };
    });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function loadAllItems() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "items", "readonly").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "meta", "readwrite").put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "meta", "readonly").get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["items", "meta"], "readwrite");
    t.objectStore("items").clear();
    t.objectStore("meta").clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
