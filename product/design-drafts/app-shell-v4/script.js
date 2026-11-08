// Prototype v4 behaviour. Voice states are simulated (tap Xiaoyu to step through them); the
// listening ring follows a made-up level, not a microphone. Nothing is recorded, sent or stored.
const $ = (selector) => document.querySelector(selector);
const stage = $("#stage"), word = $("#stateWord"), captions = $("#captions");
const WORDS = { idle: "和小宇说说话", listening: "我在听", thinking: "小宇想一想", speaking: "小宇在说" };
const NEXT = { idle: "listening", listening: "thinking", thinking: "speaking", speaking: "idle" };
let levelFrame = null, autoTimer = null;

function setState(state) {
  stage.dataset.state = state;
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
    autoTimer = setTimeout(() => setState("idle"), 4200);
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

for (const tab of document.querySelectorAll("[data-tab]")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[data-tab]")) {
      const on = other === tab;
      other.setAttribute("aria-selected", String(on));
      $(`#tab-${other.dataset.tab}`).hidden = !on;
    }
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
  if (reduced()) { launchTimer = setTimeout(showKid, 600); return; }
  launchTimer = setTimeout(() => { launch.classList.add("is-leaving"); launchTimer = setTimeout(showKid, 350); }, 1300);
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
$("#welcomeStart").addEventListener("click", showKid);
$("#replayReturning").addEventListener("click", playReturning);
$("#replayFirst").addEventListener("click", playFirst);
playReturning();
