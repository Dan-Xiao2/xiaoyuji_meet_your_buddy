import { mayArchiveMoment, stateForPersistence } from "../services/safety.js";
import { isInteractionControl } from "../services/conversationIntent.js";

export function renderAdultSummary(container, state) {
  state = stateForPersistence(state);
  const name = state.profile.name || "孩子";
  const sessionSummary = isInteractionControl(state.lastSessionSummary?.standoutQuote) ? null : state.lastSessionSummary;
  if (state.profile.showSessionSummary === false) {
    container.innerHTML = `
      <div class="summary-hidden-state">
        <strong>本次小结已关闭</strong>
        <p>成长记录仍会按照你的保存选择留在这台设备里。</p>
      </div>
    `;
    return;
  }

  const latestChild = [...(state.messages || [])]
    .reverse()
    .find((message) => message.role === "child" && message.growthEligible !== false && !isInteractionControl(message.text) && (!message.speakerRole || message.speakerRole === "child"))?.text || "";
  if (!sessionSummary?.standoutQuote && !latestChild && !state.activeLesson) {
    container.innerHTML = "";
    return;
  }

  const topic = sessionSummary?.topics?.length
    ? sessionSummary.topics.join("、")
    : state.activeLesson?.title || state.board?.title || "今天的对话";
  const quote = sessionSummary?.standoutQuote || latestChild;
  const parentPrompt = sessionSummary?.parentPrompt || (latestChild
    ? `可以接着问：你刚才说“${shortText(latestChild, 30)}”，还想到了什么？`
    : "可以问：刚才哪一部分最有意思？");

  container.innerHTML = `
    <div class="session-summary-cards" aria-label="本次陪伴小结">
      <article class="session-summary-card">
        <small>今天聊了什么</small>
        <strong>${escapeHtml(shortText(topic, 44))}</strong>
      </article>
      <article class="session-summary-card is-quote">
        <small>一句值得记住</small>
        <strong>“${escapeHtml(shortText(quote, 64))}”</strong>
      </article>
      <article class="session-summary-card is-prompt">
        <small>今晚可以接着问</small>
        <strong>${escapeHtml(removePromptPrefix(shortText(parentPrompt, 76)))}</strong>
      </article>
    </div>
  `;
}

export function renderParentTimeline(container, state, growthMoments = []) {
  const items = buildTimelineItems(stateForPersistence(state), growthMoments.filter(item => mayArchiveMoment(item) && item.reviewEligible !== false && !isInteractionControl(item.childQuote || item.childText)));

  if (!items.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <ol class="parent-timeline-list">
      ${items
        .map(
          (item) => `
            <li>
              <span class="timeline-dot" aria-hidden="true"></span>
              <div>
                <small>${escapeHtml(item.when)}</small>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </div>
            </li>
          `
        )
        .join("")}
    </ol>
  `;
}

function buildTimelineItems(state, growthMoments) {
  const name = state.profile.name || "孩子";
  const items = [];
  const lastChild = [...(state.messages || [])].reverse().find(m => m.role === "child");
  const controlTurn = lastChild?.growthEligible === false || isInteractionControl(lastChild?.text);

  if (state.lastOfflineObservation) {
    items.push({
      when: "刚刚记录",
      title: state.lastOfflineObservation.title,
      detail: `${state.lastOfflineObservation.behavior}，${state.lastOfflineObservation.support}。`
    });
  }

  if (state.session?.status === "ended" && state.lastSessionSummary?.standoutQuote && !isInteractionControl(state.lastSessionSummary.standoutQuote)) {
    items.push({
      when: "刚刚结束",
      title: state.lastSessionSummary.title,
      detail: `“${shortText(state.lastSessionSummary.standoutQuote, 32)}”`
    });
  } else if (state.activeLesson && !controlTurn) {
    items.push({
      when: "今天",
      title: state.activeLesson.title || "和小宇聊了一会儿",
      detail: shortText(state.memory?.recentWins?.[0] || `${name}愿意继续回应问题。`, 34)
    });
  }

  if (!items.length && growthMoments.length) {
    const latestMoment = [...growthMoments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const isFamilyNote = latestMoment.sourceType === "parent_note";
    items.push({
      when: formatMomentDate(latestMoment.createdAt),
      title: shortText(
        isFamilyNote ? `${latestMoment.speakerName || "家人"}补充了一条观察` : latestMoment.lessonTitle || latestMoment.topics?.[0] || "说了一句值得记住的话",
        28
      ),
      detail: `“${shortText(latestMoment.childQuote || latestMoment.childText, 34)}”`
    });
  }

  if (state.offlineTask?.status === "assigned" && !controlTurn) {
    items.push({
      when: "接下来",
      title: state.offlineTask.title,
      detail: shortText(state.offlineTask.purpose, 34)
    });
  }

  return items.slice(0, 3);
}

function formatMomentDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function removePromptPrefix(value) {
  return String(value || "").replace(/^可以(接着)?问[：:]?\s*/, "");
}

function shortText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
