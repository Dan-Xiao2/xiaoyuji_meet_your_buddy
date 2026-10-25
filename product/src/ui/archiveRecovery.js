import { parseArchiveBackup, MAX_BACKUP_BYTES } from "../data/archiveOperations.js";
import { DB_KEY, STATE_KEY, REVISION_KEY, replaceArchivePairForRecovery } from "../services/localPersistence.js";
import { LEGACY_ARCHIVE_KEYS } from "../services/archiveIntegrity.js";

export function mountArchiveRecovery(snapshot) {
  document.querySelector(".workspace").hidden = true;
  document.querySelector("#mobileMenuButton").hidden = true;
  const panel = document.querySelector("#archiveRecovery");
  panel.hidden = false;
  const status = panel.querySelector("[role=status]");
  const confirm = panel.querySelector("[data-recovery-confirm]");
  const consent = panel.querySelector("[data-recovery-consent]");
  let pending = null;
  let expected = null;
  const raw = () => Object.fromEntries([
    STATE_KEY, DB_KEY, ...Object.values(LEGACY_ARCHIVE_KEYS), REVISION_KEY, "xiaoyuji-archive-transaction-v1"
  ].map(key => [key, window.localStorage.getItem(key)]));
  const preview = pair => {
    expected = JSON.stringify(raw());
    pending = pair;
    consent.checked = false;
    confirm.hidden = false;
    panel.querySelector("[data-recovery-preview]").textContent = `${pair.state.profile.name || "孩子"} · ${pair.db.growthMoments.length} 条记录。恢复会替换本机资料，请先下载恢复文件。`;
    status.textContent = "";
  };
  panel.querySelector("[data-recovery-download]").addEventListener("click", () => {
    try {
      const file = { product: "小宇记", kind: "raw-recovery", exportedAt: new Date().toISOString(), storage: raw(), snapshot };
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "小宇记-原始恢复文件.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "恢复文件包含私人资料，请保存在自己设备上，不要公开上传。";
    } catch { status.textContent = "暂时无法下载，请保留当前浏览器数据，不要清理。"; }
  });
  panel.querySelector("[data-recovery-retry]").addEventListener("click", () => window.location.reload());
  const input = panel.querySelector("input[type=file]");
  panel.querySelector("[data-recovery-import]").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0]; input.value = "";
    if (!file) return;
    pending = null; confirm.hidden = true;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("请选择不超过 10MB 的完整备份。");
      preview(parseArchiveBackup(await file.text()));
    } catch (error) { status.textContent = error.message; }
  });
  const local = panel.querySelector("[data-recovery-local]");
  let localPair;
  try {
    localPair = parseArchiveBackup(JSON.stringify({ product: "小宇记", schemaVersion: 3,
      state: JSON.parse(snapshot?.state), localArchive: JSON.parse(snapshot?.db) }));
    local.hidden = false;
  } catch { local.hidden = true; }
  local.addEventListener("click", () => preview(localPair));
  confirm.addEventListener("submit", event => {
    event.preventDefault();
    if (!pending || !consent.checked) return;
    try {
      if (JSON.stringify(raw()) !== expected) throw new Error("本机资料已变化，请刷新后重新检查。");
      replaceArchivePairForRecovery(window.localStorage, pending.state, pending.db);
      window.location.reload();
    } catch (error) { status.textContent = error.message; }
  });
  window.lucide?.createIcons();
}
