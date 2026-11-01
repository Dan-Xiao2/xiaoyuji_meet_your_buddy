// Parent-settings panel for the family pilot: shows how much was measured, exports the file,
// and clears it. The log itself decides what may be stored (see services/pilotLog.js).
export function bindPilotLogPanel(panel, log, { getContext = () => ({}) } = {}) {
  if (!panel) return { refresh() {} };
  const count = panel.querySelector("[data-pilot-count]");
  const status = panel.querySelector("[data-pilot-status]");
  const refresh = () => {
    const entries = log.entries();
    const turns = entries.length ? Math.max(...entries.map(entry => entry.turn)) : 0;
    count.textContent = entries.length ? `本次已记录 ${turns} 轮、${entries.length} 条耗时。` : "还没有记录。开始语音聊天后会自动记录。";
  };
  panel.addEventListener("toggle", () => { if (panel.open) refresh(); });
  panel.querySelector("[data-pilot-export]").addEventListener("click", () => {
    try {
      const file = log.exportFile(getContext());
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const stamp = file.exportedAt.slice(0, 16).replace(/[-:T]/g, "");
      const link = document.createElement("a");
      link.href = url; link.download = `小宇记-测试数据-${stamp}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = file.entries.length ? "已导出。文件里只有耗时和失败原因。" : "还没有可导出的记录。";
    } catch { status.textContent = "暂时无法导出，请稍后再试。"; }
  });
  panel.querySelector("[data-pilot-clear]").addEventListener("click", () => {
    log.clear(); refresh(); status.textContent = "已清空本次测试数据。";
  });
  refresh();
  return { refresh };
}
