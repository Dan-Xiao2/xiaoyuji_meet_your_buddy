import { parseArchiveBackup, changeArchiveMoment, MAX_BACKUP_BYTES } from "../data/archiveOperations.js";
import { loadLocalStudentDb } from "../data/localStudentDb.js";
import { commitArchivePair, STATE_KEY, DB_KEY, REVISION_KEY } from "../services/localPersistence.js";
import { growthDomains } from "../data/growthInsights.js";
import { LEGACY_ARCHIVE_KEYS } from "../services/archiveIntegrity.js";

export function mountArchiveControls({ getState, requestAccess, onCommitted, onClear }) {
  const editor = document.querySelector("#momentEditor");
  const restore = document.querySelector("#restoreDialog");
  const clear = document.querySelector("#clearArchiveDialog");
  const form = document.querySelector("#momentEditorForm");
  const status = document.querySelector("#archiveControlStatus");
  const fileInput = document.querySelector("#backupImportFile");
  let editingId = null;
  let pending = null;
  let expectedDb = "";
  let returnFocus = null;
  let clearSnapshot = null;
  const rawSnapshot = () => JSON.stringify([STATE_KEY, DB_KEY, REVISION_KEY, ...Object.values(LEGACY_ARCHIVE_KEYS)].map(key => window.localStorage.getItem(key)));
  const announce = (text) => { status.textContent = text; };
  const snapshot = () => JSON.stringify(loadLocalStudentDb());
  const canChange = () => {
    if (getState().session?.status === "active") {
      announce("请先结束聊天，再整理或恢复记录。"); return false;
    }
    return true;
  };
  const apply = (pair) => {
    if (!canChange()) throw new Error("请先结束聊天。");
    if (snapshot() !== expectedDb) throw new Error("记录刚刚发生了变化，请关闭后重新打开。");
    commitArchivePair(window.localStorage, pair.state, pair.db);
    onCommitted(pair.state);
  };
  const restoreFocus = () => (returnFocus?.isConnected ? returnFocus : document.querySelector("#backupExportData"))?.focus();
  const close = (dialog) => { dialog.close(); restoreFocus(); };
  document.querySelectorAll("[data-close-archive-dialog]").forEach((button) => {
    button.addEventListener("click", () => close(button.closest("dialog")));
  });
  for (const dialog of [editor, restore, clear]) {
    dialog.addEventListener("close", () => {
      if (dialog === restore) pending = null;
      if (dialog === clear) {
        clearSnapshot = null;
        if (!getState().profile.configured) { document.querySelector("#startChildName").focus(); return; }
      }
      restoreFocus();
    });
  }
  document.querySelector("#clearData").addEventListener("click", event => {
    requestAccess(() => {
      try {
        clearSnapshot = rawSnapshot();
        returnFocus = event.target;
        document.querySelector("#clearArchiveStatus").textContent = "";
        clear.showModal();
      } catch { announce("暂时无法读取资料，请先下载备份，不要清理浏览器数据。"); }
    });
  });
  document.querySelector("#clearArchiveForm").addEventListener("submit", event => {
    event.preventDefault();
    if (!clear.open || clearSnapshot === null) return;
    try {
      if (rawSnapshot() !== clearSnapshot) throw new Error("资料刚刚发生了变化，请取消后重新确认。");
      onClear();
      clear.close();
    } catch (error) { document.querySelector("#clearArchiveStatus").textContent = error.message; }
  });
  form.elements.domain.innerHTML = Object.entries(growthDomains).map(([value, item]) => `<option value="${value}">${item.label}</option>`).join("");

  function openEditor(id, trigger) {
    requestAccess(() => {
      if (!canChange()) return;
      const moment = loadLocalStudentDb().growthMoments.find((item) => item.id === id && item.studentId === getState().studentModel.studentId);
      if (!moment) { announce("记录已不存在，请刷新后重试。"); return; }
      expectedDb = snapshot();
      editingId = id; returnFocus = trigger;
      form.elements.childQuote.value = moment.childQuote;
      form.elements.topics.value = moment.topics.join("、");
      form.elements.domain.value = moment.domain;
      form.elements.parentNote.value = moment.parentNote;
      form.elements.parentConfirmed.checked = moment.parentConfirmed;
      form.elements.reviewEligible.checked = moment.reviewEligible;
      document.querySelector("#momentEditorStatus").textContent = "";
      document.querySelector("#momentDeleteConfirm").hidden = true;
      editor.showModal();
    });
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    // Entry is parent-gated; the modal keeps that authorization until it closes.
    if (!editor.open) return;
    try {
      const changes = {
        childQuote: form.elements.childQuote.value,
        topics: [...new Set(form.elements.topics.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean))],
        domain: form.elements.domain.value, parentNote: form.elements.parentNote.value,
        parentConfirmed: form.elements.parentConfirmed.checked, reviewEligible: form.elements.reviewEligible.checked
      };
      apply(changeArchiveMoment(getState(), loadLocalStudentDb(), editingId, changes));
      close(editor); announce("已保存，成长回看已更新。");
    } catch (error) { document.querySelector("#momentEditorStatus").textContent = error.message; }
  });
  document.querySelector("#requestMomentDelete").addEventListener("click", () => {
    document.querySelector("#momentDeleteConfirm").hidden = false;
    document.querySelector("#confirmMomentDelete").focus();
  });
  document.querySelector("#cancelMomentDelete").addEventListener("click", () => { document.querySelector("#momentDeleteConfirm").hidden = true; });
  document.querySelector("#confirmMomentDelete").addEventListener("click", () => {
    if (!editor.open) return;
    try {
      apply(changeArchiveMoment(getState(), loadLocalStudentDb(), editingId, {}, true));
      close(editor); announce("已从这台设备删除。以前下载的备份需要单独处理。");
    } catch (error) { document.querySelector("#momentEditorStatus").textContent = error.message; }
  });
  document.querySelector("#backupImportButton").addEventListener("click", (event) => {
    requestAccess(() => { if (canChange()) { returnFocus = event.target; fileInput.click(); } });
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0]; fileInput.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("请选择不超过 10MB 的完整备份。");
      pending = parseArchiveBackup(await file.text());
      if (!canChange()) { pending = null; return; }
      expectedDb = snapshot();
      const dates = pending.db.growthMoments.map((item) => item.observedAt).sort();
      const dateText = dates.length ? `，${dates[0].slice(0, 10)} 至 ${dates.at(-1).slice(0, 10)}` : "";
      document.querySelector("#restorePreview").textContent = `${pending.state.profile.name || "孩子"} · ${pending.db.growthMoments.length} 条记录${dateText}`;
      document.querySelector("#restoreCurrent").textContent = `将替换这台设备现有的 ${loadLocalStudentDb().growthMoments.length} 条记录和家庭设置。建议先下载当前完整备份。`;
      document.querySelector("#restoreStatus").textContent = "";
      document.querySelector("#restoreConsent").checked = false;
      restore.showModal();
    } catch (error) { pending = null; announce(error.message); }
  });
  document.querySelector("#restoreConfirmForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!pending || !document.querySelector("#restoreConsent").checked) return;
    if (!restore.open) return;
    try {
      apply(pending);
      close(restore);
      announce("恢复完成。聊天已暂停，可以先查看记录。");
    } catch (error) { document.querySelector("#restoreStatus").textContent = error.message; }
  });
  return { openEditor, announce };
}
