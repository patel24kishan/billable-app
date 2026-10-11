// A tiny, self-contained document-store client backed by IndexedDB, shaped
// like a minimal Firestore-style API (collection/doc, where/orderBy/limit,
// onSnapshot, get/set/update/delete). The app's own logic (src/main.js) was
// originally written against that shape, so this module is a drop-in local
// replacement that persists real data in the browser — no server, no account.
//
// Every write is stamped with `updatedAt` (ISO UTC) on the stored copy, never
// on the caller's object; `add` also fills `createdAt` when the caller did not.

import { stampAdd, stampWrite } from '../schema.js';

const DB_NAME = 'billable';
const DB_VERSION = 1;
const STORE = 'documents'; // keyPath: 'path', e.g. "clients/id_abc123" or "settings/main"

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE)) {
        idb.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(idb) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(idb, record) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(idb, path) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function uid() {
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function applyWhere(docs, wheres) {
  wheres.forEach(([field, op, val]) => {
    docs = docs.filter((d) => {
      const v = d.data[field];
      if (op === '==') return v === val;
      if (op === '>=') return v >= val;
      if (op === '<=') return v <= val;
      return true;
    });
  });
  return docs;
}

function applyOrder(docs, order) {
  if (!order) return docs;
  const [field, dir] = order;
  return docs.slice().sort((a, b) => {
    const av = a.data[field], bv = b.data[field];
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'desc' ? -cmp : cmp;
  });
}

/**
 * Resolves once the store's persisted contents are loaded and ready to use.
 * options.now: () => ISO string, the clock used for createdAt/updatedAt stamps.
 */
export async function createLocalStore(options = {}) {
  const now = options.now || (() => new Date().toISOString());
  const idb = await openIdb();
  const records = await idbGetAll(idb);

  // In-memory mirror: { [collectionPath]: { [id]: data } } — kept in sync with
  // IndexedDB on every write so reads and onSnapshot listeners stay instant.
  const store = {};
  records.forEach((rec) => {
    const i = rec.path.lastIndexOf('/');
    const cpath = rec.path.slice(0, i);
    const id = rec.path.slice(i + 1);
    store[cpath] = store[cpath] || {};
    store[cpath][id] = rec.data;
  });

  const listeners = {};
  function notify(path) {
    (listeners[path] || []).forEach((fn) => fn());
  }
  function persist(path, id, data) {
    return idbPut(idb, { path: path + '/' + id, data });
  }
  function removePersisted(path, id) {
    return idbDelete(idb, path + '/' + id);
  }

  function docRef(path, id) {
    store[path] = store[path] || {};
    function del() {
      delete store[path][id];
      return removePersisted(path, id).then(() => notify(path));
    }
    return {
      set(data) {
        store[path][id] = stampWrite(data, now());
        return persist(path, id, store[path][id]).then(() => notify(path));
      },
      update(patch) {
        store[path][id] = Object.assign({}, store[path][id] || {}, patch, { updatedAt: now() });
        return persist(path, id, store[path][id]).then(() => notify(path));
      },
      delete: del,
      // Alias of delete(); call sites use remove() so a later soft delete stays inside the data layer.
      remove: del,
      get() {
        return Promise.resolve({ exists: !!store[path][id], data: () => store[path][id] });
      },
      onSnapshot(cb) {
        function fire() {
          cb({ exists: !!store[path][id], data: () => store[path][id] });
        }
        listeners[path] = listeners[path] || [];
        listeners[path].push(fire);
        fire();
        return () => {
          listeners[path] = (listeners[path] || []).filter((f) => f !== fire);
        };
      }
    };
  }

  function queryRef(path, wheres, order, lim) {
    return {
      where(field, op, val) {
        return queryRef(path, wheres.concat([[field, op, val]]), order, lim);
      },
      orderBy(field, dir) {
        return queryRef(path, wheres, [field, dir || 'asc'], lim);
      },
      limit(n) {
        return queryRef(path, wheres, order, n);
      },
      get() {
        let docs = Object.keys(store[path] || {}).map((id) => ({ id, data: store[path][id] }));
        docs = applyOrder(applyWhere(docs, wheres), order);
        if (lim) docs = docs.slice(0, lim);
        return Promise.resolve({ docs: docs.map((d) => ({ id: d.id, data: () => d.data })) });
      },
      onSnapshot(cb) {
        function fire() {
          let docs = Object.keys(store[path] || {}).map((id) => ({ id, data: store[path][id] }));
          docs = applyOrder(applyWhere(docs, wheres), order);
          if (lim) docs = docs.slice(0, lim);
          cb({ docs: docs.map((d) => ({ id: d.id, data: () => d.data })) });
        }
        listeners[path] = listeners[path] || [];
        listeners[path].push(fire);
        fire();
        return () => {
          listeners[path] = (listeners[path] || []).filter((f) => f !== fire);
        };
      }
    };
  }

  function collectionRef(path) {
    store[path] = store[path] || {};
    return {
      add(data) {
        const id = uid();
        store[path][id] = stampAdd(data, now());
        return persist(path, id, store[path][id]).then(() => {
          notify(path);
          return { id };
        });
      },
      doc(id) {
        return docRef(path, id);
      },
      orderBy(field, dir) {
        return queryRef(path, [], [field, dir || 'asc']);
      },
      where(field, op, val) {
        return queryRef(path, [[field, op, val]], null);
      },
      limit(n) {
        return queryRef(path, [], null, n);
      },
      get() {
        const docs = Object.keys(store[path]).map((id) => ({ id, data: () => store[path][id] }));
        return Promise.resolve({ docs });
      },
      onSnapshot(cb) {
        function fire() {
          const docs = Object.keys(store[path]).map((id) => ({ id, data: () => store[path][id] }));
          cb({ docs });
        }
        listeners[path] = listeners[path] || [];
        listeners[path].push(fire);
        fire();
        return () => {
          listeners[path] = (listeners[path] || []).filter((f) => f !== fire);
        };
      }
    };
  }

  return {
    collection: collectionRef,
    doc(fullPath) {
      const parts = fullPath.split('/');
      const id = parts.pop();
      const cpath = parts.join('/');
      return docRef(cpath, id);
    }
  };
}
