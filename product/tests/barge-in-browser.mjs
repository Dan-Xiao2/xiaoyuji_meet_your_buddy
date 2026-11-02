// Barge-in in the real page: speaking while Xiaoyu's reply plays stops it and starts listening,
// through the page's echo canceller (a real AudioWorklet); silence does not interrupt. With the
// switch off, speech does not interrupt and no microphone is opened, but a tap still does.
// How well echo is removed is tested in echo-canceller.test.mjs with simulated room echo.
// The microphone is a synthetic Web Audio tone; no physical microphone or external API is used.
import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = createInitialState();
  state.uiVersion = 4;
  state.profile = { ...state.profile, name: "虚构插话测试", ageBand: "4-5", configured: true, consent: true };
  state.session = { id: "barge-in-test", status: "active", turnCount: 0 };
  await page.addInitScript(initial => {
    localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(initial));
    window.micOpens = 0; window.micSpeaking = false; window.recognitionStarts = 0;
    window.micConstraints = [];
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.micOpens++;
      window.micConstraints.push(constraints.audio);
      const audio = new AudioContext(); await audio.resume();
      const tone = audio.createOscillator(), gain = audio.createGain(), out = audio.createMediaStreamDestination();
      tone.frequency.value = 220; tone.connect(gain).connect(out); tone.start();
      const set = () => { gain.gain.value = window.micSpeaking ? 0.6 : 0; requestAnimationFrame(set); };
      set();
      return out.stream;
    };
    window.SpeechRecognition = class {
      start() { window.currentRecognition = this; window.recognitionStarts++; this.onstart?.(); }
      abort() {} stop() {}
    };
    window.emitSpeech = text => {
      const recognition = window.currentRecognition, result = [{ transcript: text }]; result.isFinal = true;
      recognition.onresult({ resultIndex: 0, results: [result] }); recognition.onend();
    };
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (url !== "/api/speech/stream") return fetchOriginal(url, options);
      // Four seconds of quiet PCM keep the reply playing long enough to interrupt it.
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(24000 * 2 * 4)); controller.close(); } }),
        { headers: { "content-type": "audio/pcm", "X-Voice-Latency-Ms": "5" } });
    };
  }, state);
  const quickRequests = [];
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/tutor/quick") quickRequests.push(route.request().postDataJSON());
    const body = pathname === "/api/whiteboard/route" ? { mode: "chat" }
      : pathname === "/api/tutor/quick" ? { reply: "蜗牛背着小房子慢慢爬，它走过的地方会留下一条亮亮的线。", llmStatus: { used: true } }
      : pathname === "/api/tutor" ? { ...route.request().postDataJSON().state, board: { type: "blank" }, growthEvidence: { shouldSave: false }, llmStatus: { used: true } }
      : {};
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:4197/");
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  const phase = () => page.evaluate(() => document.querySelector(".child-voice-dock").dataset.voicePhase);
  // Like a child: tap Xiaoyu (a user gesture, which also unlocks streamed playback), then speak.
  const ask = async (text, { tap = true } = {}) => {
    const before = await page.evaluate(() => window.recognitionStarts);
    if (tap) {
      await page.locator("#mainVoiceButton").click();
      await page.waitForFunction(count => window.recognitionStarts > count, before);
    }
    await page.evaluate(text => window.emitSpeech(text), text);
  };


  await ask("虚构：蜗牛为什么慢");
  await page.waitForFunction(() => document.querySelector(".child-voice-dock").dataset.voicePhase === "speaking");
  await page.waitForTimeout(1200); // a quiet room past the warm-up does not interrupt
  assert.equal(await phase(), "speaking", "silence does not interrupt Xiaoyu");
  const listeningBefore = await page.evaluate(() => window.recognitionStarts);
  await page.evaluate(() => { window.micSpeaking = true; });
  await page.waitForFunction(count => window.recognitionStarts > count && document.querySelector(".child-voice-dock").dataset.voicePhase !== "speaking", listeningBefore, { timeout: 3000 });
  await page.evaluate(() => { window.micSpeaking = false; });
  const pilot = await page.evaluate(() => JSON.parse(sessionStorage.getItem("xiaoyuji-pilot-log-v1") || "[]"));
  assert.ok(pilot.some(entry => entry.stage === "barge-in" && entry.latencyMs >= 500), "the interruption is measured");
  const watch = pilot.find(entry => entry.stage === "barge-in-watch" && entry.levels);
  assert.ok(watch && watch.levels.echoCancellation === 0 && Number.isFinite(watch.levels.echoDelayMs), "the page's own echo canceller ran");
  // While Xiaoyu streams speech the barge-in microphone has no system echo cancellation (no call
  // audio on iPhone); listening afterwards uses normal processing again.
  const constraints = await page.evaluate(() => window.micConstraints);
  const monitor = constraints.findLastIndex(audio => audio?.echoCancellation === false);
  assert.ok(monitor >= 0, "the barge-in microphone avoids call audio");
  const afterwards = constraints.slice(monitor + 1);
  assert.ok(afterwards.length > 0 && afterwards.every(audio => audio === true || audio.echoCancellation !== false),
    "listening after the interruption uses normal (default) processing");

  // Switch off: the same speech over the next reply neither interrupts nor opens a microphone.
  await page.evaluate(() => { const toggle = document.querySelector("[data-barge-in]"); toggle.checked = false; toggle.dispatchEvent(new Event("change")); });
  assert.equal(await page.evaluate(() => localStorage.getItem("xiaoyuji-barge-in-v1")), "off");
  await ask("虚构：蜗牛住在哪里", { tap: false }); // already listening after the interruption
  await page.waitForFunction(() => document.querySelector(".child-voice-dock").dataset.voicePhase === "speaking");
  let history = quickRequests.at(-1).state.messages.filter(message => message.role === "tutor");
  assert.equal(history.at(-1).interrupted, true, "a reply the child spoke over is marked in the next request");
  const opens = await page.evaluate(() => window.micOpens);
  await page.evaluate(() => { window.micSpeaking = true; });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.micSpeaking = false; });
  assert.equal(await phase(), "speaking", "with the switch off the reply keeps playing");
  assert.equal(await page.evaluate(() => window.micOpens), opens, "no microphone is opened while it is off");
  // Tapping still interrupts, and that reply is marked too.
  const tapBefore = await page.evaluate(() => window.recognitionStarts);
  await page.locator("#mainVoiceButton").click();
  await page.waitForFunction(count => window.recognitionStarts > count && document.querySelector(".child-voice-dock").dataset.voicePhase !== "speaking", tapBefore, { timeout: 3000 });
  await ask("虚构：蜗牛吃什么", { tap: false });
  await page.waitForFunction(() => document.querySelector(".child-voice-dock").dataset.voicePhase === "speaking");
  history = quickRequests.at(-1).state.messages.filter(message => message.role === "tutor");
  assert.equal(history.at(-1).interrupted, true, "a reply cut short by a tap is marked in the next request");
  assert.deepEqual(errors, []);
  console.log("PASS barge-in: speech over a reply stops it through the echo canceller, silence does not; switched off only a tap does");
  await context.close();
} finally {
  await browser.close();
}
