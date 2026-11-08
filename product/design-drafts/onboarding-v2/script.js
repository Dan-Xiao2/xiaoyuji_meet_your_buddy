// First-use prototype v2: opening → privacy dialog → optional login (phone, WeChat, QQ, Weibo, Apple, or
// skip) → nickname → age → microphone + sound check → hand over → the child's first moment. Opening
// growth records without an account asks to log in. Nothing is saved or sent; logins only simulate
// success. The sound check opens the real microphone and only reads its level in the page.
import { xiaoyuSvg } from "../../src/ui/xiaoyuFace.js";

const $ = (selector) => document.querySelector(selector);
for (const slot of document.querySelectorAll("[data-xiaoyu]")) slot.outerHTML = xiaoyuSvg(slot.dataset.xiaoyu);
const face = (name) => { for (const svg of document.querySelectorAll(".xy")) svg.dataset.face = name; };
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const STEPS = ["opening", "login", "phone", "name", "age", "mic", "handover", "child"];
const DOTTED = ["name", "age", "mic"];
const state = { step: "opening", agreed: false, account: "", name: "", age: "", afterLogin: "name" };
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
let toastTimer = null;
function toast(text) {
  const box = $("#toast");
  box.textContent = text; box.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, 1600);
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
  $("#back").hidden = !["phone", "age", "mic", "records"].includes(step);
  ENTER[step]();
}

const ENTER = {
  opening() {
    face("happy"); say("嗨！我是小宇");
    later(() => { if (!state.agreed) openSheet("privacy"); else go("login"); }, 1600);
  },
  login() { face("idle"); say("登录后，换手机也能找回记录"); },
  phone() {
    face("idle"); say("大人的手机号");
    later(() => $("#phone").focus({ preventScroll: true }), 350);
  },
  name() {
    face("idle");
    say(state.name ? `嗨，${state.name}！` : "你叫什么名字呀？");
    later(() => $("#name").focus({ preventScroll: true }), 350);
  },
  age() { face("idle"); say(`${kid()}几岁啦？`); },
  mic() {
    face("idle"); say(`我想听听${kid()}的声音`);
    $("#micAsk").hidden = false; $("#micCheck").hidden = true; $("#micDenied").hidden = true;
  },
  handover() { face("happy"); say(`准备好啦！把手机交给${kid()}吧`); play("is-waving"); },
  child() {
    face("speaking"); say(`${kid()}，你今天看到什么好玩的了吗？`);
    later(() => face("idle"), 2400);
  },
  records() { face("happy"); say(`${state.name || "孩子"}最近说的话`); }
};

// Sheets: the privacy dialog (first open) and the login sheet (records without an account)
function openSheet(id) {
  const sheet = $(`#${id}`);
  sheet.hidden = false;
  sheet.querySelector(".primary").focus({ preventScroll: true });
}
const closeSheet = (id) => { $(`#${id}`).hidden = true; };

$("#agree").addEventListener("click", () => {
  state.agreed = true;
  closeSheet("privacy");
  go("login");
});
$("#disagree").addEventListener("click", () => {
  $("#refused").hidden = false;
  $("#disagree").textContent = "退出";
  $("#disagree").onclick = () => toast("已退出（样板）");
});
for (const link of document.querySelectorAll("[data-doc]")) {
  link.addEventListener("click", (event) => { event.preventDefault(); toast(`${link.textContent}全文待撰写`); });
}

function loggedIn(account) {
  state.account = account;
  $("#loginState").textContent = account;
  closeSheet("loginSheet");
  toast(`已登录：${account}`);
}
function provider(name) {
  toast(`正在打开${name}…`);
  later(() => {
    loggedIn(`${name}用户`);
    go(state.afterLogin);
  }, 900);
}
for (const button of document.querySelectorAll("[data-provider]")) {
  button.addEventListener("click", () => provider(button.dataset.provider));
}

// Login step
$("#phoneLogin").addEventListener("click", () => { state.afterLogin = "name"; go("phone"); });
$("#skipLogin").addEventListener("click", () => { state.afterLogin = "name"; go("name"); });

// Phone number + code (demo: any 6 digits)
const phoneOk = () => /^1\d{10}$/.test($("#phone").value);
let countdown = null;
function syncPhone() {
  $("#sendCode").disabled = !phoneOk() || countdown !== null;
  $("#phoneNext").disabled = !phoneOk() || !/^\d{6}$/.test($("#code").value);
}
$("#phone").addEventListener("input", (event) => { event.target.value = event.target.value.replace(/\D/g, ""); syncPhone(); });
$("#code").addEventListener("input", (event) => { event.target.value = event.target.value.replace(/\D/g, ""); syncPhone(); });
$("#sendCode").addEventListener("click", () => {
  let left = 60;
  const tick = () => {
    $("#sendCode").textContent = `${left} 秒`;
    if (left-- <= 0) { clearInterval(countdown); countdown = null; $("#sendCode").textContent = "重新获取"; syncPhone(); }
  };
  countdown = setInterval(tick, 1000); tick(); syncPhone();
  toast("演示：输入任意 6 位数字");
  $("#code").focus();
});
$("#phoneNext").addEventListener("click", () => {
  const phone = $("#phone").value;
  loggedIn(`${phone.slice(0, 3)}****${phone.slice(7)}`);
  go(state.afterLogin);
});

// Nickname
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
    later(() => go("mic"), 420);
  });
}

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

// Growth records: without an account, the login sheet comes up first.
$("#openRecords").addEventListener("click", () => {
  if (!state.agreed) return;
  if (state.account) { go("records"); return; }
  state.afterLogin = "records";
  openSheet("loginSheet");
});
$("#closeLoginSheet").addEventListener("click", () => closeSheet("loginSheet"));
$("#sheetPhone").addEventListener("click", () => { closeSheet("loginSheet"); go("phone"); });
$("#backToChild").addEventListener("click", () => go("child", { back: true }));

$("#back").addEventListener("click", () => {
  if (state.step === "phone") { go(state.afterLogin === "records" ? "child" : "login", { back: true }); return; }
  if (state.step === "records") { go("child", { back: true }); return; }
  if (state.step === "age") { go("name", { back: true }); return; }
  const index = STEPS.indexOf(state.step);
  if (index > 1) go(STEPS[index - 1], { back: true });
});
$("#restart").addEventListener("click", () => {
  stopMic();
  clearInterval(countdown); countdown = null;
  Object.assign(state, { agreed: false, account: "", name: "", age: "", afterLogin: "name" });
  $("#loginState").textContent = "未登录";
  for (const id of ["name", "phone", "code"]) $(`#${id}`).value = "";
  $("#nameNext").disabled = true; $("#sendCode").textContent = "获取验证码"; syncPhone();
  $("#refused").hidden = true; $("#disagree").textContent = "不同意"; $("#disagree").onclick = null;
  for (const card of document.querySelectorAll("[data-age]")) card.setAttribute("aria-checked", "false");
  $("#firstStar").classList.remove("is-shown");
  closeSheet("privacy"); closeSheet("loginSheet");
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
