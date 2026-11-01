import { recoverArchiveTransaction, STATE_KEY, assertArchiveRevision, commitArchivePair } from "./localPersistence.js";
import { stateForPersistence, mayArchiveMoment } from "./safety.js";
import { BARGE_IN_KEY, MICROPHONE_KEY } from "./microphoneInput.js";
import { clearDurableArchive, scheduleDurableArchive } from "./indexedArchive.js";
import { readArchiveValue } from "./archiveIntegrity.js";
const STORAGE_KEY = STATE_KEY;

export function loadState() {
  recoverArchiveTransaction(window.localStorage);
  assertArchiveRevision(window.localStorage);
  const saved = readArchiveValue(window.localStorage, STORAGE_KEY);
  return saved ? stateForPersistence(saved) : null;
}

export function saveState(state) {
  assertArchiveRevision(window.localStorage);
  readArchiveValue(window.localStorage, STORAGE_KEY);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stateForPersistence(state)));
  scheduleDurableArchive(window.localStorage);
}

export function clearState() {
  commitArchivePair(window.localStorage, null, null);
  window.localStorage.removeItem(MICROPHONE_KEY);
  window.localStorage.removeItem(BARGE_IN_KEY);
  clearDurableArchive();
}

export function createLocalArchiveExport(state, localArchive = {}) {
  return {
    schemaVersion: 3,
    product: "小宇记",
    storageMode: "local_first",
    exportedAt: new Date().toISOString(),
    state: stateForPersistence(state),
    localArchive: { ...localArchive, growthMoments: (localArchive.growthMoments || []).filter(mayArchiveMoment) }
  };
}

export function exportState(state, localArchive = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const backup = createLocalArchiveExport(state, localArchive);
  downloadBlob(JSON.stringify(backup, null, 2), "application/json", `小宇记-本地成长档案-${date}.json`);
}

export function exportConversationMoments(moments, format = "text", studentName = "孩子") {
  moments = moments.filter(mayArchiveMoment);
  const safeName = String(studentName || "孩子").replace(/[\\/:*?"<>|\s]+/g, "-");
  const date = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const data = {
      student: studentName,
      exportedAt: new Date().toISOString(),
      records: moments
    };
    downloadBlob(JSON.stringify(data, null, 2), "application/json", `小宇记-${safeName}-成长对话-${date}.json`);
    return;
  }

  const text = moments
    .map((item, index) => {
      const observedAt = formatDownloadDate(item.observedAt || item.createdAt);
      const topics = Array.isArray(item.topics) && item.topics.length ? `主题：${item.topics.join("、")}` : "";
      const parentNote = item.parentNote ? `家长备注：${item.parentNote}` : "";
      return [
        `${index + 1}. ${observedAt} · ${item.domainLabel || "一次探索"}`,
        topics,
        `${item.speakerName || (item.sourceType === "parent_note" ? "家人" : "孩子")}说：${item.childQuote || item.childText || ""}`,
        `小宇：${item.tutorResponse || item.tutorText || ""}`,
        parentNote
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  downloadBlob(text, "text/plain;charset=utf-8", `小宇记-${safeName}-成长对话-${date}.txt`);
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatDownloadDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未标注日期";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}
