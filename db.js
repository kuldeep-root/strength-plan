// Local storage layer. IndexedDB is the source of truth on the phone.
//  - "kv" store: small settings (sheet URL, secret, sync cursor, set ticks). Cached in memory so reads are synchronous.
//  - "checkins" store: one record per gym check-in.
// If IndexedDB is unavailable the app falls back to localStorage so it still works.

const DB_NAME = "strength-plan";
const DB_VER = 1;

let idb = null;
let fallback = false;
let writeQ = Promise.resolve();
const kv = new Map();
export const info = { mode: "idb" };

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txP = t => new Promise((res, rej) => {
  t.oncomplete = () => res();
  t.onerror = () => rej(t.error);
  t.onabort = () => rej(t.error || new Error("aborted"));
});

function openIdb() {
  return new Promise((res, rej) => {
    if (!("indexedDB" in self)) return rej(new Error("IndexedDB not available"));
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv", { keyPath: "k" });
      if (!d.objectStoreNames.contains("checkins")) d.createObjectStore("checkins", { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error("blocked"));
  });
}

export async function initDb() {
  try {
    idb = await openIdb();
    idb.onversionchange = () => idb.close();
    const rows = await reqP(idb.transaction("kv").objectStore("kv").getAll());
    rows.forEach(r => kv.set(r.k, r.v));
  } catch (e) {
    idb = null; fallback = true; info.mode = "fallback";
    try { const o = JSON.parse(localStorage.getItem("sp:kv") || "{}"); Object.keys(o).forEach(k => kv.set(k, o[k])); } catch (_) { /* ignore */ }
  }
}

/* ---------- key/value settings ---------- */
const queue = fn => { writeQ = writeQ.then(fn).catch(() => {}); return writeQ; };
const persistKvFallback = () => { try { localStorage.setItem("sp:kv", JSON.stringify(Object.fromEntries(kv))); } catch (_) { /* ignore */ } };
async function kvWrite(op, arg) {
  if (fallback) { persistKvFallback(); return; }
  const t = idb.transaction("kv", "readwrite");
  t.objectStore("kv")[op](arg);
  await txP(t);
}

export const kvGet = k => (kv.has(k) ? kv.get(k) : null);
export const kvKeys = (prefix = "") => [...kv.keys()].filter(k => k.startsWith(prefix));
export function kvSet(k, v) { kv.set(k, v); return queue(() => kvWrite("put", { k, v })); }
export function kvDel(k) { kv.delete(k); return queue(() => kvWrite("delete", k)); }
export const flush = () => writeQ;

/* ---------- check-ins ---------- */
const readFallbackCk = () => { try { return JSON.parse(localStorage.getItem("sp:ck") || "[]"); } catch (_) { return []; } };
const writeFallbackCk = arr => { try { localStorage.setItem("sp:ck", JSON.stringify(arr)); } catch (_) { /* ignore */ } };

export async function getAllCheckins() {
  if (fallback) return readFallbackCk();
  return reqP(idb.transaction("checkins").objectStore("checkins").getAll());
}
export async function getCheckin(id) {
  if (fallback) return readFallbackCk().find(r => r.id === id) || null;
  return (await reqP(idb.transaction("checkins").objectStore("checkins").get(id))) || null;
}
export async function putCheckins(recs) {
  if (!recs.length) return;
  if (fallback) {
    const map = new Map(readFallbackCk().map(r => [r.id, r]));
    recs.forEach(r => map.set(r.id, r));
    writeFallbackCk([...map.values()]);
    return;
  }
  const t = idb.transaction("checkins", "readwrite");
  const done = txP(t);
  const s = t.objectStore("checkins");
  recs.forEach(r => s.put(r));
  await done;
}
export async function getDirty(limit = 200) {
  return (await getAllCheckins()).filter(r => r.dirty).sort((a, b) => a.updatedAt - b.updatedAt).slice(0, limit);
}
export async function markAllDirty() {
  const all = await getAllCheckins();
  await putCheckins(all.map(r => ({ ...r, dirty: 1 })));
}

// Apply rows received from the sheet. Newest edit wins. Done in one transaction so a
// check-in saved at the same moment is never overwritten. Returns how many rows changed.
export async function applyRemote(recs) {
  if (!recs.length) return 0;
  const take = (l, r) => !l || r.updatedAt > l.updatedAt || (r.updatedAt === l.updatedAt && l.dirty);
  const changed = (l, r) => !l || l.updatedAt !== r.updatedAt || !!l.dirty;
  if (fallback) {
    const map = new Map(readFallbackCk().map(r => [r.id, r]));
    let n = 0;
    for (const r of recs) {
      const l = map.get(r.id);
      if (take(l, r)) { if (changed(l, r)) n++; map.set(r.id, { ...r, dirty: 0 }); }
    }
    writeFallbackCk([...map.values()]);
    return n;
  }
  const t = idb.transaction("checkins", "readwrite");
  const done = txP(t);
  const s = t.objectStore("checkins");
  let n = 0;
  await new Promise((res, rej) => {
    let pending = recs.length;
    for (const r of recs) {
      const g = s.get(r.id);
      g.onsuccess = () => {
        const l = g.result;
        if (take(l, r)) { if (changed(l, r)) n++; s.put({ ...r, dirty: 0 }); }
        if (--pending === 0) res();
      };
      g.onerror = () => rej(g.error);
    }
  });
  await done;
  return n;
}

// After a successful push: clear the dirty flag, unless the record was edited again while the request was in flight.
export async function markPushed(list) {
  if (!list.length) return;
  if (fallback) {
    const map = new Map(readFallbackCk().map(r => [r.id, r]));
    list.forEach(({ id, updatedAt }) => { const l = map.get(id); if (l && l.updatedAt === updatedAt) map.set(id, { ...l, dirty: 0 }); });
    writeFallbackCk([...map.values()]);
    return;
  }
  const t = idb.transaction("checkins", "readwrite");
  const done = txP(t);
  const s = t.objectStore("checkins");
  await new Promise((res, rej) => {
    let pending = list.length;
    for (const { id, updatedAt } of list) {
      const g = s.get(id);
      g.onsuccess = () => {
        const l = g.result;
        if (l && l.updatedAt === updatedAt) s.put({ ...l, dirty: 0 });
        if (--pending === 0) res();
      };
      g.onerror = () => rej(g.error);
    }
  });
  await done;
}

/* ---------- persistence ---------- */
export async function persistStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (_) { /* ignore */ }
  return false;
}
export async function isPersisted() {
  try { return !!(navigator.storage && navigator.storage.persisted && (await navigator.storage.persisted())); } catch (_) { return false; }
}
