// First-use prototype: opening → nickname → age → consent → microphone + sound check → hand over →
// the child's first moment. Nothing is saved. The sound check opens the real microphone and only
// reads its level in the page (no recording, no upload), then closes it.
import { xiaoyuSvg } from "../starmap-v5/face.js";

const $ = (selector) => document.querySelector(selector);
for (const slot of document.querySelectorAll("[data-xiaoyu]")) slot.outerHTML = xiaoyuSvg(slot.dataset.xiaoyu);
const face = (name) => { for (const svg of document.querySelectorAll(".xy")) svg.dataset.face = name; };
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const STEPS = ["opening", "name", "age", "consent", "mic", "handover", "child"];
const DOTTED = ["name", "age", "consent", "mic"];
const state = { step: "opening", name: "", age: "" };
const kid = () => state.name || "你";
let timers = [];
const later = (fn, ms) => { const id = setTimeout(fn, reduced() ? Math.min(ms, 300) : ms); timers.push(id); return id; };
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

function say(text) {
  const bubble = $("#bubble");
  bubble.textContent = text;
  bubble.classList.remove("is-new"); void bubble.offsetWidth; bubble.classList.add("is-new");
}
function play(className) {
  const wrap = $("#xiaoyuWrap");
  wrap.classList.remove(className); void wrap.offsetWidth; wrap.classList.add(className);
}

function go(step, { back = false } = {}) {
  clearTimers();
  if (state.step === "mic" && step !== "mic") stopMic();
  state.step = step;
  document.body.dataset.step = step;
  for (const section of document.querySelectorAll(".step")) {
    const on = section.dataset.step === step;
    section.hidden = !on;
    if (on) { section.classList.toggle("from-left", back); section.style.animation = "none"; void section.offsetWidth; section.style.animation = ""; }
  }
  const dotted = DOTTED.indexOf(step);
  $("#dots").hidden = dotted < 0;
  [...$("#dots").children].forEach((dot, index) => { dot.className = index < dotted ? "is-done" : index === dotted ? "is-current" : ""; });
  $("#back").hidden = !["age", "consent", "mic"].includes(step);
  ENTER[step]();
}

const ENTER = {
  opening() { face("happy"); say("嗨！我是小宇"); later(() => go("name"), 2000); },
  name() {
    face("idle");
    say(state.name ? `嗨，${state.name}！` : "你叫什么名字呀？");
    later(() => $("#name").focus({ preventScroll: true }), 350);
  },
  age() { face("idle"); say(`${kid()}几岁啦？`); },
  consent() { face("idle"); say("开始前，请大人看一下"); },
  mic() {
    face("idle"); say(`我想听听${kid()}的声音`);
    $("#micAsk").hidden = false; $("#micCheck").hidden = true; $("#micDenied").hidden = true;
  },
  handover() { face("happy"); say(`准备好啦！把手机交给${kid()}吧`); play("is-waving"); },
  child() {
    face("speaking"); say(`${kid()}，你今天看到什么好玩的了吗？`);
    later(() => face("idle"), 2400);
  }
};

// Nickname: Xiaoyu greets the child by name as it is typed.
let typing = null;
$("#name").addEventListener("input", (event) => {
  state.name = event.target.value.trim();
  $("#nameNext").disabled = !state.name;
  clearTimeout(typing);
  face("idle");
  say(state.name ? `嗨，${state.name}！` : "你叫什么名字呀？");
  if (state.name) typing = setTimeout(() => face("happy"), 600);
});
$("#name").addEventListener("keydown", (event) => { if (event.key === "Enter" && state.name) go("age"); });
$("#nameNext").addEventListener("click", () => go("age"));

// Age: one tap chooses and moves on.
for (const card of document.querySelectorAll("[data-age]")) {
  card.addEventListener("click", () => {
    state.age = card.dataset.age;
    for (const other of document.querySelectorAll("[data-age]")) other.setAttribute("aria-checked", String(other === card));
    face("happy");
    later(() => go("consent"), 420);
  });
}

$("#agree").addEventListener("click", () => go("mic"));

// Microphone + sound check
let mic = null;
function stopMic() {
  if (!mic) return;
  cancelAnimationFrame(mic.frame);
  mic.stream.getTracks().forEach((track) => track.stop());
  mic.context.close().catch(() => {});
  mic = null;
  document.body.classList.remove("is-listening");
}
async function startMic() {
  // Created in the tap, which also unlocks audio playback on an iPhone.
  const context = new (window.AudioContext || window.webkitAudioContext)();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("unsupported", "NotSupportedError");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await context.resume().catch(() => {});
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    mic = { context, stream, analyser, frame: 0 };
    face("happy"); play("is-hopping"); say("谢谢！");
    later(listen, 700);
  } catch (error) {
    context.close().catch(() => {});
    face("idle");
    say("我还听不到你");
    $("#micAsk").hidden = true; $("#micDenied").hidden = false;
  }
}
function listen() {
  if (!mic) return;
  $("#micAsk").hidden = true; $("#micCheck").hidden = false;
  $("#micDone").hidden = true; $("#micSkip").hidden = false;
  document.querySelector(".say").hidden = false;
  face("listening"); say("我在听……");
  document.body.classList.add("is-listening");
  const samples = new Float32Array(mic.analyser.fftSize);
  let loudSince = null;
  const nudge = later(() => say("大声一点点试试？"), 8000);
  const tick = () => {
    if (!mic) return;
    mic.analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) sum += value * value;
    const level = Math.sqrt(sum / samples.length);
    document.documentElement.style.setProperty("--level", (1 + Math.min(level * 5, .28)).toFixed(3));
    if (level > .035) loudSince ??= performance.now(); else if (level < .02) loudSince = null;
    if (loudSince !== null && performance.now() - loudSince > 300) { clearTimeout(nudge); heard(); return; }
    mic.frame = requestAnimationFrame(tick);
  };
  mic.frame = requestAnimationFrame(tick);
}
function heard() {
  stopMic();
  face("happy"); play("is-hopping"); say("我听到啦！");
  const star = $("#firstStar");
  star.classList.remove("is-shown"); void star.offsetWidth; star.classList.add("is-shown");
  document.querySelector(".say").hidden = true;
  $("#micSkip").hidden = true; $("#micDone").hidden = false;
}
$("#allowMic").addEventListener("click", startMic);
$("#micRetry").addEventListener("click", () => { $("#micDenied").hidden = true; $("#micAsk").hidden = false; startMic(); });
$("#micDone").addEventListener("click", () => go("handover"));
$("#micSkip").addEventListener("click", () => go("handover"));
$("#micLater").addEventListener("click", () => go("handover"));

$("#toChild").addEventListener("click", () => go("child"));
$("#xiaoyuWrap").addEventListener("click", () => {
  if (state.step !== "child") return;
  face("listening"); say("我在听……");
  later(() => { face("happy"); say("真有意思！"); }, 2200);
});

$("#back").addEventListener("click", () => {
  const index = STEPS.indexOf(state.step);
  if (index > 1) go(STEPS[index - 1], { back: true });
});
$("#restart").addEventListener("click", () => {
  stopMic();
  Object.assign(state, { name: "", age: "" });
  $("#name").value = ""; $("#nameNext").disabled = true;
  for (const card of document.querySelectorAll("[data-age]")) card.setAttribute("aria-checked", "false");
  $("#firstStar").classList.remove("is-shown");
  go("opening");
});

// Occasional blink (not while smiling)
(function blink() {
  setTimeout(() => {
    if (!reduced()) for (const svg of document.querySelectorAll(".xy")) if (svg.dataset.face !== "happy") {
      svg.classList.add("is-blinking"); setTimeout(() => svg.classList.remove("is-blinking"), 140);
    }
    blink();
  }, 3000 + Math.random() * 2500);
})();

window.addEventListener("DOMContentLoaded", () => window.lucide?.createIcons());
if (document.readyState !== "loading") window.lucide?.createIcons();
go("opening");
