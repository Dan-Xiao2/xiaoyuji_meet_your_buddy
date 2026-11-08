// Prototype v4 behaviour. Voice states are simulated (tap Xiaoyu to step through them); the
// listening ring follows a made-up level, not a microphone. Nothing is recorded, sent or stored.
import { xiaoyuSvg } from "./face.js";
const $ = (selector) => document.querySelector(selector);
// Every Xiaoyu on the page is the SVG face; setFace changes all of them together.
for (const slot of document.querySelectorAll("[data-xiaoyu]")) slot.outerHTML = xiaoyuSvg(slot.dataset.xiaoyu);
const faces = () => document.querySelectorAll(".xy");
function setFace(face) { for (const svg of faces()) svg.dataset.face = face; }
const FACE = { idle: "idle", listening: "listening", thinking: "thinking", speaking: "speaking" };
let faceTimer = null;
const stage = $("#stage"), word = $("#stateWord"), captions = $("#captions");
const WORDS = { idle: "和小宇说说话", listening: "我在听", thinking: "小宇想一想", speaking: "小宇在说" };
const NEXT = { idle: "listening", listening: "thinking", thinking: "speaking", speaking: "idle" };
let levelFrame = null, autoTimer = null;

function setState(state) {
  stage.dataset.state = state;
  clearTimeout(faceTimer);
  setFace(FACE[state]);
  word.textContent = WORDS[state];
  $("#xiaoyu").setAttribute("aria-label", WORDS[state]);
  captions.classList.toggle("is-empty", state !== "speaking");
  cancelAnimationFrame(levelFrame);
  clearTimeout(autoTimer);
  if (state === "listening") {
    const started = performance.now();
    const tick = (now) => {
      const t = (now - started) / 1000;
      const level = Math.max(0, Math.sin(t * 7) * 0.5 + Math.sin(t * 2.3) * 0.5); // fake syllables
      stage.style.setProperty("--level", (1 + level * 0.18).toFixed(3));
      levelFrame = requestAnimationFrame(tick);
    };
    levelFrame = requestAnimationFrame(tick);
    autoTimer = setTimeout(() => setState("thinking"), 2600);
  } else if (state === "thinking") {
    autoTimer = setTimeout(() => setState("speaking"), 1400);
  } else if (state === "speaking") {
    // After answering she looks pleased for a moment, then settles.
    autoTimer = setTimeout(() => { setState("idle"); setFace("happy"); faceTimer = setTimeout(() => setFace("idle"), 1400); }, 4200);
  }
}
$("#xiaoyu").addEventListener("click", () => setState(NEXT[stage.dataset.state] || "idle"));

// Parent gate: hold for 1.2 s. A tap only shows a hint, so a child does not wander in.
const gate = $("#parentGate"), hint = $("#gateHint");
let holdTimer = null;
const release = () => { clearTimeout(holdTimer); gate.classList.remove("is-holding"); };
gate.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  gate.classList.add("is-holding");
  hint.hidden = true;
  holdTimer = setTimeout(() => { release(); openParent(); }, 1200);
});
gate.addEventListener("pointerup", () => { if (gate.classList.contains("is-holding")) { hint.hidden = false; setTimeout(() => { hint.hidden = true; }, 1500); } release(); });
gate.addEventListener("pointerleave", release);
gate.addEventListener("pointercancel", release);
gate.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openParent(); } });

function openParent() {
  setState("idle");
  $("#kid").hidden = true;
  $("#parent").hidden = false;
  document.body.dataset.view = "parent";
  window.scrollTo(0, 0);
  $("#backToKid").focus();
}
$("#backToKid").addEventListener("click", () => { $("#parent").hidden = true; document.body.dataset.view = "kid"; $("#kid").hidden = false; gate.focus(); });

// Tab bar feedback: pressed (shrinks under the finger), a pill that slides to the chosen tab, a
// small once-only movement of that tab's icon, and the page sliding in from the side it came from.
const tabs = [...document.querySelectorAll("[data-tab]")];
let current = 0;
const restart = (node, className) => { node.classList.remove(className); void node.offsetWidth; node.classList.add(className); };
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("pointerdown", () => tab.classList.add("is-pressed"));
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) tab.addEventListener(type, () => tab.classList.remove("is-pressed"));
  tab.addEventListener("click", () => {
    if (index === current) return;
    const panel = $(`#tab-${tab.dataset.tab}`);
    panel.style.setProperty("--from", `${index > current ? 16 : -16}px`);
    for (const other of tabs) {
      const on = other === tab;
      other.setAttribute("aria-selected", String(on));
      $(`#tab-${other.dataset.tab}`).hidden = !on;
    }
    $(".tab-indicator").style.setProperty("--i", index);
    restart(tab, "is-arriving");
    restart(panel, "is-entering");
    navigator.vibrate?.(8); // a light tick where supported (Android); iOS Safari has none
    current = index;
    window.scrollTo(0, 0);
  });
}

$("#backdrop").addEventListener("change", (event) => { document.body.dataset.backdrop = event.target.value; });
window.addEventListener("DOMContentLoaded", () => window.lucide?.createIcons());
if (document.readyState !== "loading") window.lucide?.createIcons();

// Opening. Returning: Xiaoyu rises with a small bounce and greets the child by name, then the chat
// screen appears (about 1.6 s; at once with reduced motion). First time: a welcome page whose
// only action is 开始; in the real product setup would follow.
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Blinks now and then (not while smiling), every 3–5.5 s.
(function blink() {
  setTimeout(() => {
    if (!reduced()) for (const svg of faces()) if (svg.dataset.face !== "happy") {
      svg.classList.add("is-blinking"); setTimeout(() => svg.classList.remove("is-blinking"), 140);
    }
    blink();
  }, 3000 + Math.random() * 2500);
})();
let launchTimer = null;
function showKid() {
  $("#launch").hidden = true; $("#welcome").hidden = true; $("#parent").hidden = true;
  $("#kid").hidden = false; document.body.dataset.view = "kid";
  $("#kid").classList.remove("is-arriving"); void $("#kid").offsetWidth; $("#kid").classList.add("is-arriving");
}
function playReturning() {
  clearTimeout(launchTimer);
  setState("idle");
  $("#welcome").hidden = true;
  const launch = $("#launch");
  launch.classList.remove("is-leaving");
  $("#parent").hidden = true; $("#kid").hidden = false;
  const spot = $("#xiaoyu").getBoundingClientRect(), wordSpot = $("#stateWord").getBoundingClientRect();
  launch.style.setProperty("--x-left", `${spot.left}px`); launch.style.setProperty("--x-top", `${spot.top}px`);
  launch.style.setProperty("--x-size", `${spot.width}px`);
  launch.style.setProperty("--w-top", `${wordSpot.top}px`); launch.style.setProperty("--w-line", `${wordSpot.height}px`);
  launch.hidden = false;
  for (const node of launch.querySelectorAll("*")) { node.style.animation = "none"; void node.offsetWidth; node.style.animation = ""; }
  setFace("idle");
  faceTimer = setTimeout(() => setFace("happy"), reduced() ? 0 : 450); // smiles as she says hello
  if (reduced()) { launchTimer = setTimeout(showKid, 600); return; }
  launchTimer = setTimeout(() => { launch.classList.add("is-leaving"); launchTimer = setTimeout(() => { showKid(); faceTimer = setTimeout(() => setFace("idle"), 400); }, 350); }, 1300);
}
function playFirst() {
  clearTimeout(launchTimer);
  setState("idle");
  $("#launch").hidden = true;
  const welcome = $("#welcome");
  welcome.hidden = false;
  for (const node of welcome.querySelectorAll("*")) { node.style.animation = "none"; void node.offsetWidth; node.style.animation = ""; }
  $("#welcomeStart").focus({ preventScroll: true });
}
$("#welcomeStart").addEventListener("click", () => { setFace("happy"); setTimeout(() => { showKid(); setFace("idle"); }, reduced() ? 0 : 500); });
$("#replayReturning").addEventListener("click", playReturning);
$("#replayFirst").addEventListener("click", playFirst);

// ===== v5: star map =====
// Stable randomness from a string, so a topic always gets the same place, mark and colour.
function seeded(text) {
  let h = 2166136261;
  for (const char of String(text)) { h ^= char.codePointAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

// Demo discoveries (fictional), newest last. Day 13 is today.
const MOMENTS = [
  { day: 0, date: "10月21日 周二", quote: "树叶为什么会变黄？", topic: "树叶", note: "自己发现了季节的变化。" },
  { day: 2, date: "10月23日 周四", quote: "我的影子比我还长！", topic: "影子", note: "注意到了下午的影子。" },
  { day: 4, date: "10月25日 周六", quote: "小狗是在笑吗？", topic: "小狗", note: "在猜动物的感受。" },
  { day: 6, date: "10月27日 周一", quote: "我想把彩虹画下来。", topic: "彩虹", note: "主动说想画画。" },
  { day: 9, date: "10月30日 周四", quote: "我搭了一个比我还高的塔。", topic: "积木", note: "试了三次才搭稳。" },
  { day: 9, date: "10月30日 周四", quote: "紫色是红色和蓝色变的。", topic: "颜色", note: "说出了混色的规律。" },
  { day: 11, date: "11月1日 周六", quote: "月亮跟着我们的车走！", topic: "月亮", note: "在车上观察到的。" },
  { day: 13, date: "今天 · 11月3日", quote: "蜗牛的房子会不会越背越重呀？", topic: "蜗牛", note: "自己提出了一个“为什么”，还接着猜了答案。" }
];
const TONES = [["#fde3cc", "#c46a2b"], ["#dbeef3", "#2f7088"], ["#e3f0dc", "#4c7d43"], ["#f7ecc9", "#9a7417"], ["#eee1f3", "#80529a"], ["#f8dfdf", "#a54848"]];

function pattern(topic) {
  const rand = seeded(topic), [tint, ink] = TONES[Math.floor(rand() * TONES.length)];
  const cells = [];
  for (let row = 0; row < 5; row++) {
    const half = [rand() > .45, rand() > .45, rand() > .35];
    for (const on of [half[0], half[1], half[2], half[1], half[0]]) cells.push(`<b class="${on ? "" : "off"}"></b>`);
  }
  return `<span class="pattern" style="--tint:${tint};--ink-tone:${ink}" aria-hidden="true">${cells.join("")}</span>`;
}

// Growth tab: stars by day (x) and topic (y); tap one to read it. Today is selected first.
let selected = MOMENTS.length - 1;
function renderGrowth() {
  const svg = $("#starmap"), W = 340, H = 180;
  const points = MOMENTS.map((moment, index) => {
    const rand = seeded(moment.topic);
    return { index, x: 14 + moment.day * ((W - 28) / 13), y: 22 + rand() * (H - 50), today: index === MOMENTS.length - 1 };
  });
  const path = points.map((point, i) => `${i ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  svg.innerHTML = `<path class="constellation" d="${path}" />` + points.map(point => {
    const r = point.today ? 7 : 4.5;
    return `<g class="star${point.today ? " is-today" : ""}${point.index === selected ? " is-selected" : ""}" data-index="${point.index}" tabindex="0" role="button" aria-label="${MOMENTS[point.index].date}：${MOMENTS[point.index].topic}">
      <circle class="glow" cx="${point.x}" cy="${point.y}" r="${r * 2.6}" /><circle class="core" cx="${point.x}" cy="${point.y}" r="${r}" /></g>`;
  }).join("");
  const moment = MOMENTS[selected];
  $("#momentCard").innerHTML = `<time>${moment.date}</time><blockquote>“${moment.quote}”</blockquote>
    <span class="topic">${pattern(moment.topic)}${moment.topic}</span><p>${moment.note}</p>`;
  const recent = MOMENTS.filter(item => item.day >= 7 && item !== moment);
  const byDate = new Map();
  for (const item of recent.reverse()) (byDate.get(item.date) || byDate.set(item.date, []).get(item.date)).push(item);
  $("#weekList").innerHTML = [...byDate].map(([date, items]) => `<li><time>${date}</time>${items.map(item =>
    `<article class="moment">${pattern(item.topic)}<div><p>“${item.quote}”</p><span>${item.topic}</span></div></article>`).join("")}</li>`).join("");
}
$("#starmap").addEventListener("click", event => {
  const star = event.target.closest(".star");
  if (star) { selected = Number(star.dataset.index); renderGrowth(); }
});
$("#starmap").addEventListener("keydown", event => {
  const star = event.target.closest(".star");
  if (star && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selected = Number(star.dataset.index); renderGrowth(); $(`.star[data-index="${selected}"]`).focus(); }
});
renderGrowth();
playReturning();
