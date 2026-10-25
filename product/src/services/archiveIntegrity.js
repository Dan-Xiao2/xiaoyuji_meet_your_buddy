import { DB_KEY, STATE_KEY } from "./localPersistence.js";

export const LEGACY_ARCHIVE_KEYS = {
  [STATE_KEY]: "momo-learning-mvp-state",
  [DB_KEY]: "momo-learning-local-student-db"
};
const object = value => Boolean(value && typeof value === "object" && !Array.isArray(value));

// This validates the storage envelope, not the semantic quality of model evidence.
export function parseStoredArchiveValue(raw, key) {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    if (!object(value)) throw new Error();
    if (key === STATE_KEY) {
      if (!object(value.profile)) throw new Error();
      if (value.studentModel !== undefined && !object(value.studentModel)) throw new Error();
      if (value.messages !== undefined && (!Array.isArray(value.messages) || value.messages.some(item => !object(item)))) throw new Error();
    } else {
      if (!object(value.studentModels) || (value.schemaVersion !== undefined && (![1, 2, 3].includes(value.schemaVersion)))) throw new Error();
      for (const field of ["growthMoments", "conversationMoments", "sessions", "events"]) {
        if (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].some(item => !object(item)))) throw new Error();
      }
    }
    return value;
  } catch (cause) {
    throw new Error("本机记录暂时无法读取，已停止覆盖原始内容。请先下载恢复文件。", { cause });
  }
}

export function readArchiveRaw(storage, key) {
  return storage.getItem(key) ?? storage.getItem(LEGACY_ARCHIVE_KEYS[key]);
}

export function readArchiveValue(storage, key) {
  return parseStoredArchiveValue(readArchiveRaw(storage, key), key);
}

export function validateStoredArchive(storage) {
  const state = readArchiveValue(storage, STATE_KEY);
  const db = readArchiveValue(storage, DB_KEY);
  if (!state && db) throw new Error("本机孩子资料缺失，成长记录仍保留。请先下载恢复文件。");
  return { state, db };
}
