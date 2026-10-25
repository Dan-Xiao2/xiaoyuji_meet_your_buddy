export function renderOfflineTask(container, task, lastObservation) {
  if (!task || task.status === "empty") {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="offline-task-card">
      <div class="task-title-row">
        <div>
          <div class="task-meta">
            <span>${escapeHtml(task.domain)}</span>
            <span>${escapeHtml(cleanDuration(task.screenTime))}</span>
          </div>
          <h3>${escapeHtml(task.title)}</h3>
        </div>
        <span class="screen-away-label">离开屏幕</span>
      </div>
      <p class="task-purpose">${escapeHtml(task.purpose)}</p>
      <p class="task-materials"><strong>准备：</strong>${task.materials.map(escapeHtml).join("、")}</p>
      <ol class="task-steps">
        ${task.steps.slice(0, 3).map((step) => `<li><span>${escapeHtml(step)}</span></li>`).join("")}
      </ol>
      <blockquote class="adult-prompt">
        <small>可以这样问</small>
        <p>“${escapeHtml(cleanAdultPrompt(task.adultPrompt))}”</p>
      </blockquote>
      <details class="task-details">
        <summary>看看为什么推荐这个活动</summary>
        <p>${escapeHtml(task.reason)}</p>
        <p><strong>留意：</strong>${task.observeFocus.map(escapeHtml).join("；")}</p>
      </details>
      ${
        lastObservation
          ? `<div class="last-observation">
              <strong>你上次记下了</strong>
              <p>${escapeHtml(lastObservation.behavior)}，${escapeHtml(lastObservation.support)}。</p>
            </div>`
          : ""
      }
    </div>
  `;
}

function stripTrailingPunctuation(value) {
  return String(value || "").replace(/[。！？!?]+$/, "");
}

function cleanAdultPrompt(value) {
  return stripTrailingPunctuation(value).replace(/^你可以问[：:]\s*/, "");
}

function cleanDuration(value) {
  return String(value || "").replace(/^(AI 互动后|听完故事后|故事后|建议孩子端)\s*/, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
