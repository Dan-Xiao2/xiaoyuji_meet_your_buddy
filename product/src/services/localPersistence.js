export const STATE_KEY = "xiaoyuji-learning-state-v1";
export const DB_KEY = "xiaoyuji-local-student-db-v1";
const JOURNAL_KEY = "xiaoyuji-archive-transaction-v1";
export const REVISION_KEY = "xiaoyuji-archive-revision-v1";
const KEYS = [DB_KEY, STATE_KEY, "momo-learning-local-student-db", "momo-learning-mvp-state", REVISION_KEY];
const observedRevisions = new WeakMap();

// An archive replacement invalidates writers that still hold the previous family state.
// This is a stale-writer guard, not an atomic lock between browser tabs.
export function assertArchiveRevision(storage) {
  const revision = storage.getItem(REVISION_KEY);
  if (!observedRevisions.has(storage)) observedRevisions.set(storage, revision);
  if (observedRevisions.get(storage) !== revision) throw new Error("本机档案已在其他页面变化，请刷新后重试。");
}

// Recover interrupted archive changes before either store is read.
export function recoverArchiveTransaction(storage) {
  const journal = storage.getItem(JOURNAL_KEY);
  if (journal === null) return;
  const previous = JSON.parse(journal);
  if (!previous || typeof previous !== "object" || Array.isArray(previous)
    || !Object.hasOwn(previous, STATE_KEY) || !Object.hasOwn(previous, DB_KEY)
    || [...KEYS, JOURNAL_KEY].some(key => previous[key] != null && typeof previous[key] !== "string")) {
    throw new Error("档案恢复信息无法读取，原始内容仍保留。");
  }
  KEYS.forEach((key) => storage.removeItem(key));
  for (const key of KEYS) {
    if (typeof previous[key] === "string") storage.setItem(key, previous[key]);
  }
  if (typeof previous[JOURNAL_KEY] === "string") storage.setItem(JOURNAL_KEY, previous[JOURNAL_KEY]);
  else storage.removeItem(JOURNAL_KEY);
}

export function commitArchivePair(storage, state, db) {
  recoverArchiveTransaction(storage);
  writeArchivePair(storage, state, db);
}

// Only the recovery screen may replace unreadable data after validating a backup
// and obtaining explicit consent. Rollback includes the original damaged journal.
export function replaceArchivePairForRecovery(storage, state, db) {
  writeArchivePair(storage, state, db);
}

function writeArchivePair(storage, state, db) {
  assertArchiveRevision(storage);
  const previous = Object.fromEntries(KEYS.map((key) => [key, storage.getItem(key)]));
  const previousJournal = storage.getItem(JOURNAL_KEY);
  if (previousJournal !== null) previous[JOURNAL_KEY] = previousJournal;
  const nextDb = JSON.stringify(db);
  const nextState = JSON.stringify(state);
  try { storage.setItem(JOURNAL_KEY, JSON.stringify(previous)); }
  catch (error) { throw new Error("设备空间不足，尚未修改原记录。请先下载备份。", { cause: error }); }
  try {
    if (db === null) storage.removeItem(DB_KEY); else storage.setItem(DB_KEY, nextDb);
    if (state === null) storage.removeItem(STATE_KEY); else storage.setItem(STATE_KEY, nextState);
    storage.removeItem("momo-learning-local-student-db");
    storage.removeItem("momo-learning-mvp-state");
    storage.setItem(REVISION_KEY, globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
    storage.removeItem(JOURNAL_KEY);
  } catch (error) {
    recoverArchiveTransaction(storage);
    throw new Error("保存失败，原记录已保留。请先下载备份，再检查设备存储空间。", { cause: error });
  }
  observedRevisions.set(storage, storage.getItem(REVISION_KEY));
}
