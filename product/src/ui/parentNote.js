export function createParentNoteText(state) {
  const name = state.profile.name || "孩子";
  const lesson = state.activeLesson;
  const task = state.offlineTask;
  const assessment = state.lastAssessment;
  const observation = state.lastOfflineObservation;
  const story = lesson?.story;
  const skillLabel = labelSkill(lesson?.skill);
  const nextAction = task
    ? `${task.title}：${task.steps?.slice(0, 2).join("；") || task.purpose}`
    : "今天可以从孩子感兴趣的话题开始，聊到自然想停时就结束，再观察孩子会不会主动表达。";

  const evidence = assessment
    ? assessment.correct
      ? `刚才在“${skillLabel}”里能答对，并愿意继续尝试下一题。`
      : `刚才在“${skillLabel}”里需要一点提示，系统会降低难度并换成更直观的白板。`
    : `今天主要观察孩子是否愿意开口、选择、复述和动手探索。`;

  const contentLine = story
    ? `今天的内容围绕《${story.title}》，重点观察${story.domainLabels?.join("、") || "表达和探索"}。${
        story.childChoice ? `${name}选择了${story.childChoice}，可以继续鼓励孩子讲出自己的理由。` : ""
      }`
    : `${name}今天的重点不是多学几个知识点，而是通过短对话和现实小任务，观察表达、理解和探索兴趣。`;

  const offlineEvidence = observation
    ? `我记录到：${labelObservation(observation.completion)}，${labelObservation(observation.support)}，主要表现是${labelObservation(
        observation.behavior
      )}。${observation.notes}`
    : "我还没有记录线下观察。可以先看孩子是否愿意动手、是否能说出自己看到的东西。";

  return [
    `【今天我看懂了什么】`,
    contentLine,
    `孩子的小线索：${evidence}`,
    `接下来可以这样陪：${nextAction}`,
    `${offlineEvidence}`,
    `提醒：不需要完成固定时长，重点不是多学知识，而是让孩子自然说出来、画出来、在真实生活里试一试。`
  ].join("\n");
}

export function renderParentNote(container, state) {
  const note = createParentNoteText(state);
  container.innerHTML = `
    <div class="parent-note">
      ${note
        .split("\n")
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("")}
    </div>
  `;
}

function labelSkill(skill) {
  const labels = {
    "math.subtract_as_takeaway": "5 以内拿走/剩下",
    "math.counting_1_to_5": "5 以内数数",
    "language.full_sentence": "完整表达",
    "algebra.distributive_property": "分配律"
  };
  return labels[skill] || "表达和探索";
}

function labelObservation(value) {
  const labels = {
    completed: "完成了",
    partial: "做了一部分",
    not_interested: "不太感兴趣",
    no_support: "基本不用提示",
    some_support: "需要一点提示",
    much_support: "需要很多提示",
    expressed: "主动表达",
    recounted: "重新数了一遍",
    distracted: "容易分心",
    high_interest: "明显感兴趣"
  };
  return labels[value] || value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
