const stateData = {
  first: {
    periodLabel: "今天",
    summary: "刚刚开始",
    discovery: "今天，他反复聊到小猫，也试着确认小宇有没有听见。",
    explorationTitle: "今天",
    note: ["01", "一天只讲一件事", "不生成周报和月报。先让家长看见孩子今天在意什么。"],
    week: [
      { label: "一", values: [] },
      { label: "二", values: [] },
      { label: "三", values: [] },
      { label: "四", values: [] },
      { label: "五", values: [] },
      { label: "六", values: [] },
      { label: "今", values: [["nature", 28], ["expression", 18], ["people", 12]] }
    ],
    showPeriods: false,
    showChange: false,
    showKeepsake: false
  },
  weeks: {
    periodLabel: "最近 14 天",
    summary: "8 次小发现",
    discovery: "小动物仍然是他最常回到的话题，也开始主动讲给家人听。",
    explorationTitle: "最近 7 天",
    note: ["02", "把重复变成变化", "同一兴趣跨越多个日子后，才出现趋势和前后对照。"],
    week: [
      { label: "一", values: [["nature", 22]] },
      { label: "二", values: [] },
      { label: "三", values: [["expression", 20], ["people", 12]] },
      { label: "四", values: [["story", 17]] },
      { label: "五", values: [] },
      { label: "六", values: [["nature", 36], ["expression", 18]] },
      { label: "今", values: [["people", 24], ["nature", 30]] }
    ],
    month: [
      { label: "第 1 周", values: [18, 9, 6, 4] },
      { label: "第 2 周", values: [28, 18, 12, 8] },
      { label: "第 3 周", values: [34, 25, 15, 10] },
      { label: "这周", values: [44, 29, 24, 15] }
    ],
    showPeriods: true,
    showChange: true,
    changeType: "compare",
    changeTitle: "他开始主动分享了",
    change: ["会问：它叫什么？", "会说：我为什么喜欢它"],
    showKeepsake: true,
    keepsakeDate: "8 月 29 日",
    keepsake: "“我想给小猫搭一个不会淋雨的家。”"
  },
  long: {
    periodLabel: "过去 3 个月",
    summary: "42 次小发现",
    discovery: "焘焘从观察小动物，慢慢走到了主动分享和自己编故事。",
    explorationTitle: "最近 30 天",
    note: ["03", "长期才谈成长轨迹", "记录足够多以后，用一条清楚的路径呈现兴趣怎样延伸。"],
    week: [
      { label: "一", values: [["story", 22], ["expression", 18]] },
      { label: "二", values: [["nature", 28]] },
      { label: "三", values: [["people", 22], ["expression", 16]] },
      { label: "四", values: [] },
      { label: "五", values: [["story", 34], ["nature", 18]] },
      { label: "六", values: [["nature", 38], ["expression", 26]] },
      { label: "今", values: [["story", 42], ["people", 18]] }
    ],
    month: [
      { label: "第 1 周", values: [25, 10, 8, 6] },
      { label: "第 2 周", values: [32, 18, 14, 12] },
      { label: "第 3 周", values: [36, 27, 20, 25] },
      { label: "这周", values: [40, 32, 24, 42] }
    ],
    showPeriods: true,
    defaultPeriod: "month",
    showChange: true,
    changeType: "journey",
    changeTitle: "一个兴趣，慢慢长出了新方向",
    change: ["发现小动物", "主动讲给别人", "自己编成故事"],
    showKeepsake: true,
    keepsakeDate: "8 月 29 日",
    keepsake: "“等我长大了，我要开一间小动物医院。”"
  }
};

const elements = {
  phoneContent: document.querySelector("#phoneContent"),
  periodLabel: document.querySelector("#periodLabel"),
  recordSummary: document.querySelector("#recordSummary"),
  discoveryTitle: document.querySelector("#discoveryTitle"),
  explorationTitle: document.querySelector("#explorationTitle"),
  periodControl: document.querySelector("#periodControl"),
  chartWrap: document.querySelector("#chartWrap"),
  changeSection: document.querySelector("#changeSection"),
  changeTitle: document.querySelector("#changeTitle"),
  changePath: document.querySelector("#changePath"),
  keepsakeSection: document.querySelector("#keepsakeSection"),
  keepsakeDate: document.querySelector("#keepsakeDate"),
  keepsakeTitle: document.querySelector("#keepsakeTitle"),
  noteIndex: document.querySelector("#noteIndex"),
  noteTitle: document.querySelector("#noteTitle"),
  noteBody: document.querySelector("#noteBody"),
  menuButton: document.querySelector(".menu-button"),
  drawer: document.querySelector(".app-drawer"),
  scrim: document.querySelector(".drawer-scrim")
};

let currentState = "first";
let currentPeriod = "week";

function renderState(stateKey) {
  currentState = stateKey;
  const data = stateData[stateKey];
  currentPeriod = data.defaultPeriod || "week";

  document.querySelectorAll("[data-state]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.state === stateKey));
  });

  elements.periodLabel.textContent = data.periodLabel;
  elements.recordSummary.textContent = data.summary;
  elements.discoveryTitle.textContent = data.discovery;
  elements.explorationTitle.textContent = data.explorationTitle;
  elements.periodControl.hidden = !data.showPeriods;
  elements.changeSection.hidden = !data.showChange;
  elements.keepsakeSection.hidden = !data.showKeepsake;
  elements.noteIndex.textContent = data.note[0];
  elements.noteTitle.textContent = data.note[1];
  elements.noteBody.textContent = data.note[2];

  if (data.showChange) renderChange(data);
  if (data.showKeepsake) {
    elements.keepsakeDate.textContent = data.keepsakeDate;
    elements.keepsakeTitle.textContent = data.keepsake;
  }

  setPeriod(currentPeriod, false);
  elements.phoneContent.classList.remove("is-refreshing");
  requestAnimationFrame(() => elements.phoneContent.classList.add("is-refreshing"));
  elements.phoneContent.scrollTo({ top: 0, behavior: "smooth" });
}

function setPeriod(period, animate = true) {
  const data = stateData[currentState];
  currentPeriod = period;
  document.querySelectorAll("[data-period]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.period === period));
  });
  elements.explorationTitle.textContent = period === "month" ? "最近 30 天" : data.explorationTitle;
  elements.chartWrap.innerHTML = period === "month" ? renderMonthChart(data.month || []) : renderWeekChart(data.week);
  if (animate) {
    elements.chartWrap.animate(
      [{ opacity: 0.35, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  }
}

function renderWeekChart(days) {
  return `<div class="week-chart" role="img" aria-label="最近七天探索领域分布">
    ${days.map((day) => `<div class="day-column"><div class="day-track">${day.values
      .map(([type, height], index) => `<i class="${type}" style="height:${height}px;animation-delay:${index * 45}ms"></i>`)
      .join("")}</div><span>${day.label}</span></div>`).join("")}
  </div>`;
}

function renderMonthChart(weeks) {
  return `<div class="month-chart" role="img" aria-label="最近三十天探索领域分布">
    ${weeks.map((week) => `<div class="month-week"><div class="month-stack">${week.values
      .map((height, index) => `<i class="${["nature", "expression", "people", "story"][index]}" style="height:${height}px;animation-delay:${index * 45}ms"></i>`)
      .join("")}</div><span>${week.label}</span></div>`).join("")}
  </div>`;
}

function renderChange(data) {
  elements.changeTitle.textContent = data.changeTitle;
  if (data.changeType === "journey") {
    elements.changePath.innerHTML = `<div class="journey-path">${data.change.map((label, index) => `<div class="journey-step"><small>${["开始", "后来", "现在"][index]}</small><strong>${label}</strong></div>`).join("")}</div>`;
    return;
  }
  elements.changePath.innerHTML = `
    <div class="change-step"><small>刚开始</small><strong>${data.change[0]}</strong></div>
    <span class="change-arrow" aria-hidden="true"></span>
    <div class="change-step"><small>最近</small><strong>${data.change[1]}</strong></div>`;
}

function setDrawer(open) {
  elements.menuButton.setAttribute("aria-expanded", String(open));
  elements.drawer.setAttribute("aria-hidden", String(!open));
  elements.drawer.classList.toggle("is-open", open);
  elements.scrim.hidden = false;
  requestAnimationFrame(() => elements.scrim.classList.toggle("is-open", open));
  if (!open) window.setTimeout(() => { elements.scrim.hidden = true; }, 210);
}

document.querySelectorAll("[data-state]").forEach((button) => {
  button.addEventListener("click", () => renderState(button.dataset.state));
});

document.querySelectorAll("[data-period]").forEach((button) => {
  button.addEventListener("click", () => setPeriod(button.dataset.period));
});

elements.menuButton.addEventListener("click", () => setDrawer(elements.menuButton.getAttribute("aria-expanded") !== "true"));
elements.scrim.addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setDrawer(false);
});

renderState("first");
