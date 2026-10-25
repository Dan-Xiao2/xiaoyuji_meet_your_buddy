import { DB_KEY, STATE_KEY, REVISION_KEY, commitArchivePair, recoverArchiveTransaction } from "./localPersistence.js";
import { parseStoredArchiveValue, readArchiveRaw, validateStoredArchive } from "./archiveIntegrity.js";

const DATABASE_NAME = "xiaoyuji-local-archive";
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "current";
let writeQueue = Promise.resolve();
let durability = { status: "unavailable", savedAt: null };
const listeners = new Set();

export function getDurableArchiveStatus() { return { ...durability }; }
export function subscribeDurableArchive(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function report(status, savedAt = durability.savedAt) {
  durability = { status, savedAt };
  for (const listener of listeners) listener(getDurableArchiveStatus());
}
export function flushDurableArchive() { return writeQueue; }

export function createDurableSnapshot(storage) {
  return {
    state: readArchiveRaw(storage, STATE_KEY),
    db: readArchiveRaw(storage, DB_KEY),
    revision: storage.getItem(REVISION_KEY),
    savedAt: new Date().toISOString()
  };
}

export function recoverDurableSnapshot(storage, snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if ((snapshot.revision ?? null) !== storage.getItem(REVISION_KEY)) return false;
  if (readArchiveRaw(storage, STATE_KEY) !== null || readArchiveRaw(storage, DB_KEY) !== null) return false;
  let state, db;
  try {
    state = parseStoredArchiveValue(snapshot.state, STATE_KEY);
    db = parseStoredArchiveValue(snapshot.db, DB_KEY);
  } catch { return false; }
  if (!state || !db) return false;
  commitArchivePair(storage, state, db);
  return true;
}

export async function initializeDurableArchive(storage = window.localStorage) {
  let db, snapshot;
  let transactionReady = false;
  try {
    recoverArchiveTransaction(storage);
    transactionReady = true;
    if (globalThis.indexedDB) {
      db = await openArchiveDb();
      snapshot = await requestResult(db.transaction(STORE_NAME).objectStore(STORE_NAME).get(SNAPSHOT_KEY));
      if (snapshot && (snapshot.revision ?? null) !== storage.getItem(REVISION_KEY)) snapshot = null;
    }
    const restored = recoverDurableSnapshot(storage, snapshot);
    try {
      validateStoredArchive(storage);
      if (!restored && readArchiveRaw(storage, DB_KEY) === null && snapshot?.db) {
        throw new Error("本机成长记录缺失，备用副本仍保留。");
      }
    } catch (error) {
      return { available: Boolean(db), restored: false, snapshot, needsRecovery: true, error: error.message };
    }
    if (db) {
      const next = createDurableSnapshot(storage);
      await writeSnapshot(db, next);
      report("saved", next.savedAt);
    } else report("unavailable");
    return { available: Boolean(db), restored, snapshot };
  } catch (error) {
    report("error");
    return { available: false, restored: false, snapshot, needsRecovery: !transactionReady, error: error.message };
  } finally { db?.close(); }
}

export function scheduleDurableArchive(storage = window.localStorage) {
  if (!globalThis.indexedDB) { report("unavailable"); return; }
  const revision = storage.getItem(REVISION_KEY);
  writeQueue = writeQueue.then(async () => {
    const db = await openArchiveDb();
    try {
      if (revision !== storage.getItem(REVISION_KEY)) return;
      validateStoredArchive(storage);
      const snapshot = createDurableSnapshot(storage);
      await writeSnapshot(db, snapshot);
      report("saved", snapshot.savedAt);
    } finally { db.close(); }
  }).catch(() => { report("error"); });
  return writeQueue;
}

export function clearDurableArchive(storage = window.localStorage) {
  if (!globalThis.indexedDB) { report("unavailable"); return; }
  const revision = storage.getItem(REVISION_KEY);
  writeQueue = writeQueue.then(async () => {
    const db = await openArchiveDb();
    try {
      if (revision !== storage.getItem(REVISION_KEY)) return;
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(SNAPSHOT_KEY);
      await transactionDone(transaction);
      report("cleared", null);
    } finally { db.close(); }
  }).catch(() => { report("error"); });
  return writeQueue;
}

function openArchiveDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function writeSnapshot(db, snapshot) {
  const transaction = db.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
  return transactionDone(transaction);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
