import { APP_NAV_ITEMS } from "../../src/ui/appNavigation.js";

const $ = (selector) => document.querySelector(selector);
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const mascot = '<img src="../../assets/xiaoyu-planet.png" alt="" width="232" height="232">';
const iconNames = { talk: "messages-square", growth: "sprout", parent: "users", backup: "archive" };
const states = {
  talk: { idle: "等待开始", listening: "正在听", thinking: "正在想", drawing: "白板展开", error: "连接失败" },
  growth: { data: "有记录", empty: "没有记录", loading: "正在加载", error: "加载失败" },
  parent: { form: "填写资料", error: "保存失败" },
  backup: { data: "有记录", empty: "没有记录" }
};
// Fixtures and edits stay in memory; this draft never reads or writes family storage.
const moments = [
  { date: "2026-08-18", topic: "颜色", text: "给画里的汽车挑了蓝色。" },
  { date: "2026-09-03", topic: "汽车", text: "想知道汽车为什么有四个轮子。" },
  { date: "2026-09-05", topic: "搭建", text: "试着给积木房子加了一扇窗。" },
  { date: "2026-09-08", topic: "汽车", text: "发现小汽车和公交车的轮子不一样多。" },
  { date: "2026-09-09", topic: "颜色", text: "给自己的小汽车挑了新颜色。" },
  { date: "2026-09-09", topic: "汽车", text: "接着问起轮子是怎么转起来的。" }
];
let view = "talk", state = "idle", range = 7, offset = 0, selectedBucket = null;
let profile = { name: "安安", save: true }, saving = false, saved = false, timer;
let boardListening = true, failNextSave = false;
const escape = (value) => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const day = 86400000, anchor = Date.UTC(2026, 8, 9);
const iso = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
const shortDate = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
function icons() { window.lucide.createIcons(); }
function toast(message) {
  clearTimeout(timer); $("#toast").textContent = message; $("#toast").hidden = false;
  timer = setTimeout(() => { $("#toast").hidden = true; }, 2400);
}
function navigation() {
  const markup = APP_NAV_ITEMS.map(item => `<button class="nav-button" data-view="${item.action}" ${view === item.action ? 'aria-current="page"' : ""}>${icon(iconNames[item.action])}<span>${item.label}</span></button>`).join("");
  $("#desktop-nav").innerHTML = markup; $("#drawer-nav").innerHTML = markup;
}
function show(next) {
  const fromDesktop = $("#desktop-nav").contains(document.activeElement);
  view = next; state = Object.keys(states[view])[0]; selectedBucket = null; saved = false;
  if ($("#drawer").open) $("#drawer").close();
  navigation(); render();
  if (fromDesktop) $(`#desktop-nav [data-view="${view}"]`).focus();
}
function voiceMarkup(small = false) {
  const label = small ? (boardListening ? "暂停倾听" : "继续聊天") : state === "idle" ? "开始聊天" : state === "error" ? "重新连接" : state === "listening" ? "暂停倾听" : "暂停聊天";
  return `<button class="voice-button" id="voice" aria-label="${label}" title="${label}" ${state === "thinking" ? "disabled" : ""}>${mascot}</button>`;
}
function talk() {
  const active = state !== "idle";
  const caption = { idle: "开始聊天", listening: "我在听", thinking: "想一想", error: "连接没成功" }[state];
  return `<div class="talk-header"><div class="speaker">${icon("user-round")}<span>${escape(profile.name)}</span></div>${active ? '<button class="button text" id="end-talk">结束</button>' : ""}</div>
    ${state === "drawing" ? `<div class="paper" aria-label="演示白板：一辆汽车"><img src="../../assets/whiteboard/fluent/car.svg" alt="小汽车"></div><div class="board-controls">${voiceMarkup(true)}<span role="status">${boardListening ? "我在听" : "已暂停"}</span></div>` : `<section class="talk-stage" data-state="${state}" aria-label="语音入口">${voiceMarkup()}
    <div class="voice-caption" role="status"><p>${caption}</p>${state === "error" ? '<small class="error-text">点小宇，再试一次</small>' : state === "thinking" ? '<span class="thinking-mark" aria-hidden="true"><b></b><b></b><b></b></span>' : ""}</div></section>`}`;
}
function growthData() {
  const end = anchor - offset * range * day;
  const start = range === 0 ? Date.UTC(2026, 7, 1) : end - (range - 1) * day;
  const records = state === "empty" ? [] : moments.filter(m => m.date >= iso(start) && m.date <= iso(end));
  const count = range === 7 ? 7 : range === 30 ? 5 : 2;
  const buckets = Array.from({ length: count }, (_, i) => {
    const from = range === 0 ? Date.UTC(2026, 7 + i, 1) : start + i * (range === 7 ? 1 : 6) * day;
    const to = range === 0 ? Math.min(Date.UTC(2026, 8 + i, 1) - day, end) : Math.min(from + (range === 7 ? 0 : 5) * day, end);
    return { from: iso(from), to: iso(to), label: range === 0 ? `${8 + i}月` : shortDate(iso(from)), records: records.filter(m => m.date >= iso(from) && m.date <= iso(to)) };
  });
  return { start, end, records, buckets };
}
function growth() {
  const data = growthData();
  const rangeControls = `<div class="range-bar"><div class="segments" role="radiogroup" aria-label="时间范围">${[[7, "7天"], [30, "30天"], [0, "全部"]].map(([value, label]) => `<label><input type="radio" name="range" value="${value}" ${range === value ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>
    <div class="date-stepper"><button class="icon-button" id="previous" aria-label="上一时段" title="上一时段" ${range === 0 ? "disabled" : ""}>${icon("chevron-left")}</button><span>${shortDate(iso(data.start))} – ${shortDate(iso(data.end))}</span><button class="icon-button" id="next" aria-label="下一时段" title="下一时段" ${offset === 0 || range === 0 ? "disabled" : ""}>${icon("chevron-right")}</button></div></div>`;
  let body;
  if (state === "loading") body = '<div class="empty" role="status" aria-busy="true"><div class="skeleton"></div><div class="skeleton short"></div><p>正在整理记录</p></div>';
  else if (state === "error") body = `<div class="empty">${icon("cloud-off")}<h2>记录暂时没能打开</h2><button class="button" id="retry-growth">${icon("rotate-ccw")}再试一次</button></div>`;
  else if (!data.records.length) body = `<div class="empty">${icon("calendar-days")}<h2>这段时间还没有记录</h2><button class="button" data-view="talk">去和小宇聊聊</button></div>`;
  else {
    const topics = [...new Set(data.records.map(m => m.topic))];
    const days = new Set(data.records.map(m => m.date)).size;
    const max = Math.max(...data.buckets.map(b => b.records.length));
    const visible = selectedBucket === null ? data.records.slice(-3).reverse() : data.buckets[selectedBucket].records.slice().reverse();
    body = `<div class="discovery"><div><div class="eyebrow">这一段的小发现</div><p>${escape(profile.name)}聊到了${topics.join("、")}，留下了自己的问题和想法。</p></div><img src="../../assets/whiteboard/fluent/car.svg" alt="" width="110" height="110"></div>
      <section aria-label="探索记录"><div class="chart-heading"><h2>探索过的日子</h2><small>${days}天 · ${data.records.length}个片段</small></div>
      <div class="chart" style="--columns:${data.buckets.length}">${data.buckets.map((b, i) => `<button data-bucket="${i}" aria-label="${b.label}，${b.records.length}个片段" aria-pressed="${selectedBucket === i}"><span class="track"><span class="bar" style="--bar-height:${b.records.length / max * 100}%"></span></span><span>${b.label}</span></button>`).join("")}</div><div class="legend"><i aria-hidden="true"></i>留下的片段</div></section>
      <section class="moments" aria-label="成长片段"><h2>${selectedBucket === null ? "最近的片段" : data.buckets[selectedBucket].label}</h2>${visible.length ? visible.map(m => `<article class="moment"><time datetime="${m.date}">${shortDate(m.date)}</time><div><strong>${m.topic}</strong><p>${m.text}</p></div></article>`).join("") : '<p class="muted">这天还没有记录</p>'}</section>`;
  }
  return `<div class="page-heading"><div><div class="eyebrow">慢慢长大</div><h1>${escape(profile.name)}的成长</h1></div></div>${rangeControls}${body}`;
}
function settings() {
  return `<div class="settings"><div class="page-heading"><h1>家庭设置</h1></div><form id="profile-form" novalidate>
    <section class="form-section"><h2>孩子的资料</h2><label class="field" for="nickname">昵称<input id="nickname" type="text" maxlength="24" value="${escape(profile.name)}" required aria-describedby="name-error"><small id="name-error" class="error-text" hidden>写一个昵称吧</small></label></section>
    <section class="form-section"><h2>一起陪伴的人</h2><div class="setting-row"><div><span class="member-icon">${icon("user-round")}</span>妈妈</div><small>家长</small></div><div class="setting-row"><div><span class="member-icon">${icon("user-round")}</span>爸爸</div><small>家长</small></div></section>
    <section class="form-section"><label class="setting-row" for="save-moments"><span>保存成长片段<small>留在这台设备，随时可以管理</small></span><input id="save-moments" class="switch" type="checkbox" role="switch" ${profile.save ? "checked" : ""}></label></section>
    <div class="form-footer"><button class="button primary" type="submit" ${saving ? "disabled" : ""}>${saving ? "保存中" : "保存"}</button><span id="save-feedback" role="status" ${state === "error" ? 'class="error-text"' : ""}>${state === "error" ? "没能保存，再试一次" : saved ? "已保存本次演示设置" : ""}</span></div>
    </form></div>`;
}
function backup() {
  return `<div class="settings"><div class="page-heading"><h1>备份记录</h1></div>${state === "empty" ? '<div class="empty"><h2>还没有可备份的记录</h2></div>' : `<div class="backup-info">${icon("file-heart")}<div><strong>成长片段</strong><small>8/18 – 9/9 · ${moments.length}个演示片段</small></div></div><button class="button primary" id="download">${icon("download")}下载演示备份</button>`}</div>`;
}
function render() {
  $("#preview-state").innerHTML = Object.entries(states[view]).map(([value, label]) => `<option value="${value}" ${state === value ? "selected" : ""}>${label}</option>`).join("");
  $("#content").innerHTML = ({ talk, growth, parent: settings, backup })[view]();
  icons();
}
$("#preview-state").addEventListener("change", e => { state = e.target.value; selectedBucket = null; boardListening = true; failNextSave = view === "parent" && state === "error"; render(); });
$("#menu-open").addEventListener("click", () => { $("#drawer").showModal(); $("#menu-open").setAttribute("aria-expanded", "true"); });
$("#menu-close").addEventListener("click", () => $("#drawer").close());
$("#drawer").addEventListener("close", () => { $("#menu-open").setAttribute("aria-expanded", "false"); $("#menu-open").focus(); });
$("#drawer").addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  const buttons = [...$("#drawer").querySelectorAll("button")];
  const first = buttons[0], last = buttons.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
$("#drawer").addEventListener("click", e => { if (e.target === $("#drawer") && e.clientX > $("#drawer").getBoundingClientRect().right) $("#drawer").close(); });
document.addEventListener("click", e => {
  const target = e.target.closest("button, .brand"); if (!target) return;
  if (target.dataset.view) { show(target.dataset.view); return; }
  if (target.classList.contains("brand")) { e.preventDefault(); show("talk"); return; }
  if (target.id === "voice") {
    if (state === "drawing") {
      boardListening = !boardListening;
      $(".board-controls [role=status]").textContent = boardListening ? "我在听" : "已暂停";
      const label = boardListening ? "暂停倾听" : "继续聊天";
      target.setAttribute("aria-label", label); target.title = label;
    } else { state = state === "listening" ? "idle" : "listening"; render(); $("#voice").focus(); }
  }
  if (target.id === "end-talk") { state = "idle"; render(); $("#voice").focus(); }
  if (target.id === "retry-growth") { state = "data"; render(); $("input[name=range]:checked").focus(); }
  if (target.id === "previous" || target.id === "next") { offset += target.id === "previous" ? 1 : -1; selectedBucket = null; render(); $("#previous").focus(); }
  if (target.dataset.bucket !== undefined) { selectedBucket = Number(target.dataset.bucket); render(); $(`[data-bucket="${selectedBucket}"]`).focus(); }
  if (target.id === "download") {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ demo: true, moments }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "xiaoyu-design-demo.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast("已下载演示备份");
  }
});
$("#content").addEventListener("change", e => {
  if (e.target.name === "range") { range = Number(e.target.value); offset = 0; selectedBucket = null; render(); $("input[name=range]:checked").focus(); }
  if (e.target.id === "save-moments") { profile.save = e.target.checked; saved = false; }
});
$("#content").addEventListener("input", e => {
  if (e.target.id === "nickname") { profile.name = e.target.value; saved = false; e.target.removeAttribute("aria-invalid"); $("#name-error").hidden = true; $("#save-feedback").textContent = ""; }
});
$("#content").addEventListener("submit", async e => {
  e.preventDefault(); if (saving) return;
  if (!profile.name.trim()) { $("#nickname").setAttribute("aria-invalid", "true"); $("#name-error").hidden = false; $("#nickname").focus(); return; }
  profile.name = profile.name.trim(); saving = true; const fail = failNextSave; failNextSave = false; render();
  await new Promise(resolve => setTimeout(resolve, 500));
  saving = false; saved = !fail;
  if (view === "parent") { state = fail ? "error" : "form"; render(); $("#profile-form button[type=submit]").focus(); }
});
navigation(); render();
