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
      // A headset is recognised from the track label, as Safari reports "AirPods Pro".
      if (window.micLabel) for (const track of out.stream.getAudioTracks()) Object.defineProperty(track, "label", { value: window.micLabel });
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
    // A dog's bark: listening ends without any recognised speech.
    window.emitNothing = () => window.currentRecognition.onend();
    const fetchOriginal = window.fetch.bind(window);
    window.quickBodies = [];
    const encoder = new TextEncoder();
    window.fetch = async (url, options) => {
      if (url === "/api/tutor/quick/stream") {
        // A streamed reply of two sentences, the first short, so an interruption lands in the second.
        window.quickBodies.push(JSON.parse(options.body));
        return new Response(new ReadableStream({ start(controller) {
          const line = item => controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
          line({ type: "sentence", text: "蜗牛背着小房子。" });
          line({ type: "sentence", text: "它走过的地方会留下一条亮亮的线。" });
          line({ type: "done", reply: "蜗牛背着小房子。它走过的地方会留下一条亮亮的线。", llmStatus: { used: true } });
          controller.close();
        } }), { headers: { "content-type": "application/x-ndjson" } });
      }
      if (url !== "/api/speech/stream") return fetchOriginal(url, options);
      // Quiet PCM: 0.3 s for the first sentence, then four seconds, long enough to interrupt.
      const seconds = JSON.parse(options.body).text.startsWith("蜗牛背着") ? 0.3 : 4;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(Math.round(24000 * seconds) * 2)); controller.close(); } }),
        { headers: { "content-type": "audio/pcm", "X-Voice-Latency-Ms": "5" } });
    };
  }, state);
  const lastQuick = () => page.evaluate(() => window.quickBodies.at(-1));
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
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
  // A loud sound only makes Xiaoyu quieter while listening starts; nothing recognised, she carries on.
  let listeningBefore = await page.evaluate(() => window.recognitionStarts);
  await page.evaluate(() => { window.micSpeaking = true; });
  await page.waitForFunction(count => window.recognitionStarts > count, listeningBefore, { timeout: 3000 });
  await page.evaluate(() => { window.micSpeaking = false; });
  // (The page shows "listening" now; Xiaoyu goes on quietly.)
  const confirmed = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("xiaoyuji-pilot-log-v1") || "[]").some(entry => entry.stage === "barge-in-confirmed"));
  assert.equal(await confirmed(), false, "not stopped by a sound alone");
  const opensAfterBark = await page.evaluate(() => window.micOpens);
  await page.evaluate(() => window.emitNothing());
  await page.waitForFunction(count => window.micOpens > count, opensAfterBark, { timeout: 3000 }); // watching again
  await page.waitForFunction(() => document.querySelector(".child-voice-dock").dataset.voicePhase === "speaking", null, { timeout: 2000 });
  assert.equal(await confirmed(), false, "a bark does not stop Xiaoyu");
  // The child: the same sound, and this time speech is recognised (below), which stops her.
  await page.waitForTimeout(700);
  listeningBefore = await page.evaluate(() => window.recognitionStarts);
  await page.evaluate(() => { window.micSpeaking = true; });
  await page.waitForFunction(count => window.recognitionStarts > count, listeningBefore, { timeout: 3000 });
  await page.evaluate(() => { window.micSpeaking = false; });
  const pilot = await page.evaluate(() => JSON.parse(sessionStorage.getItem("xiaoyuji-pilot-log-v1") || "[]"));
  assert.ok(pilot.some(entry => entry.stage === "barge-in" && entry.latencyMs >= 500), "the interruption is measured");
  assert.ok(pilot.some(entry => entry.stage === "barge-in-dismissed"), "the bark is recorded as dismissed");
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
  await ask("虚构：蜗牛住在哪里", { tap: false }); // the child's words, recognised: Xiaoyu stops and answers
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem("xiaoyuji-pilot-log-v1") || "[]").some(entry => entry.stage === "barge-in-confirmed"));
  await page.waitForFunction(count => window.quickBodies.length > count, 1);
  await page.waitForFunction(() => document.querySelector(".child-voice-dock").dataset.voicePhase === "speaking");
  let history = (await lastQuick()).state.messages.filter(message => message.role === "tutor");
  assert.equal(history.at(-1).interrupted, true, "a reply the child spoke over is marked in the next request");
  // The child spoke during the second sentence: only the first was heard whole.
  assert.equal(history.at(-1).heard, "蜗牛背着小房子。", "the next request says which whole sentences the child heard");
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
  history = (await lastQuick()).state.messages.filter(message => message.role === "tutor");
  assert.equal(history.at(-1).interrupted, true, "a reply cut short by a tap is marked in the next request");
  // AirPods: no echo to cancel, so the barge-in microphone is the normal one and is handed over to
  // listening (switching between raw and processed made iOS deliver a silent stream).
  await page.evaluate(() => { window.micLabel = "AirPods Pro"; const toggle = document.querySelector("[data-barge-in]"); toggle.checked = true; toggle.dispatchEvent(new Event("change")); });
  await page.waitForFunction(() => document.querySelector(".child-voice-dock").dataset.voicePhase === "speaking");
  // This reply's barge-in microphone reports "AirPods Pro"; from the next reply the headset mode is used.
  await page.waitForTimeout(800);
  await page.locator("#mainVoiceButton").click();
  await ask("虚构：蜗牛会睡觉吗", { tap: false });
  await page.waitForFunction(() => document.querySelector(".child-voice-dock").dataset.voicePhase === "speaking");
  const sinceTap = await page.evaluate(() => window.micConstraints.length);
  await page.locator("#mainVoiceButton").click();
  await ask("虚构：蜗牛的家在哪里", { tap: false });
  await page.waitForFunction(() => document.querySelector(".child-voice-dock").dataset.voicePhase === "speaking");
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => ({ starts: window.recognitionStarts }));
  await page.evaluate(() => { window.micSpeaking = true; });
  await page.waitForFunction(count => window.recognitionStarts > count, before.starts, { timeout: 3000 });
  await page.evaluate(() => { window.micSpeaking = false; });
  const after = await page.evaluate(() => ({ constraints: window.micConstraints }));
  const headsetOpens = after.constraints.slice(sinceTap);
  assert.ok(headsetOpens.length >= 1, "the barge-in microphone was opened");
  assert.ok(headsetOpens.every(audio => audio === true || audio.echoCancellation !== false), "with AirPods no raw microphone is opened");
  // (Handing the stream to listening is the recorder path used on iPhone; this test listens with the
  // browser's own recognition, which opens its own level meter, so it is not asserted here.)
  const headsetWatch = (await page.evaluate(() => JSON.parse(sessionStorage.getItem("xiaoyuji-pilot-log-v1") || "[]")))
    .filter(entry => entry.stage === "barge-in-watch" && entry.levels).at(-1);
  assert.equal(headsetWatch.levels.headset, 1);
  assert.equal(headsetWatch.levels.inputKind, 2, "the microphone's kind is recorded, never its name");
  // AirPods taken off: the switch is recorded with the turn in progress.
  await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem("xiaoyuji-pilot-log-v1") || "[]").some(entry => entry.stage === "audio-device-change"));
  assert.equal(JSON.stringify(await page.evaluate(() => sessionStorage.getItem("xiaoyuji-pilot-log-v1"))).includes("AirPods"), false);
  assert.deepEqual(errors, []);
  console.log("PASS barge-in: speech over a reply stops it through the echo canceller, silence does not; switched off only a tap does");
  await context.close();
} finally {
  await browser.close();
}
