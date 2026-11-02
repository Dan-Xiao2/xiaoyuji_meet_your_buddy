// Sentence-by-sentence replies in the real page: speech for the first sentence is requested, and
// playback starts, before the model has finished the reply; every sentence is spoken once, and the
// committed reply is the whole text. No model, speech service or microphone is used.
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
  state.profile = { ...state.profile, name: "虚构逐句测试", ageBand: "4-5", configured: true, consent: true };
  state.session = { id: "streaming-reply-test", status: "active", turnCount: 0 };
  await page.addInitScript(initial => {
    localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(initial));
    window.recognitionStarts = 0; window.events = []; window.speechTexts = [];
    navigator.mediaDevices.getUserMedia = async () => { throw new Error("No microphone in this test"); };
    window.SpeechRecognition = class {
      start() { window.currentRecognition = this; window.recognitionStarts++; this.onstart?.(); }
      abort() {} stop() {}
    };
    window.emitSpeech = text => {
      const recognition = window.currentRecognition, result = [{ transcript: text }]; result.isFinal = true;
      recognition.onresult({ resultIndex: 0, results: [result] }); recognition.onend();
    };
    const fetchOriginal = window.fetch.bind(window);
    const encoder = new TextEncoder();
    window.fetch = async (url, options) => {
      if (url === "/api/tutor/quick/stream") {
        // The model "writes" slowly: one sentence now, one after 800 ms, done after 1200 ms.
        return new Response(new ReadableStream({ start(controller) {
          const line = item => controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
          line({ type: "sentence", text: "蜗牛背着小房子。" }); window.events.push("sentence-1");
          setTimeout(() => { line({ type: "sentence", text: "它爬过的地方亮晶晶的。" }); window.events.push("sentence-2"); }, 800);
          setTimeout(() => { line({ type: "done", reply: "蜗牛背着小房子。它爬过的地方亮晶晶的。", llmStatus: { used: true } }); window.events.push("done"); controller.close(); }, 1200);
        } }), { headers: { "content-type": "application/x-ndjson" } });
      }
      if (url === "/api/speech/stream") {
        const text = JSON.parse(options.body).text;
        window.speechTexts.push(text); window.events.push(`speech:${text}`);
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(24000 * 2 * 2)); controller.close(); } }),
          { headers: { "content-type": "audio/pcm", "X-Voice-Latency-Ms": "5" } });
      }
      return fetchOriginal(url, options);
    };
  }, state);
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === "/api/whiteboard/route" ? { mode: "chat" }
      : pathname === "/api/tutor" ? { ...route.request().postDataJSON().state, board: { type: "blank" }, growthEvidence: { shouldSave: false }, llmStatus: { used: true } }
      : {};
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:4197/");
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await page.locator("#mainVoiceButton").click(); // a tap: unlocks streamed playback
  await page.waitForFunction(() => window.recognitionStarts > 0);
  await page.evaluate(() => window.emitSpeech("虚构：我看到一只蜗牛"));

  await page.waitForFunction(() => document.querySelector(".child-voice-dock").dataset.voicePhase === "speaking", null, { timeout: 5000 });
  const atSpeaking = await page.evaluate(() => [...window.events]);
  assert.ok(!atSpeaking.includes("done"), `speaking began before the reply was finished: ${atSpeaking.join(", ")}`);
  assert.ok(atSpeaking.indexOf("speech:蜗牛背着小房子。") >= 0 && atSpeaking.indexOf("speech:蜗牛背着小房子。") < atSpeaking.indexOf("sentence-2") || !atSpeaking.includes("sentence-2"),
    "speech for the first sentence was requested before the second sentence arrived");

  await page.waitForFunction(() => window.events.includes("done"));
  await page.waitForFunction(() => window.speechTexts.length === 2);
  assert.deepEqual(await page.evaluate(() => window.speechTexts), ["蜗牛背着小房子。", "它爬过的地方亮晶晶的。"], "each sentence is spoken once, in order");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).messages.some(message => message.role === "tutor" && message.text === "蜗牛背着小房子。它爬过的地方亮晶晶的。"));
  const pilot = await page.evaluate(() => JSON.parse(sessionStorage.getItem("xiaoyuji-pilot-log-v1") || "[]"));
  // (response-start is measured from the end of a recorded capture; this test uses browser recognition.)
  assert.ok(pilot.some(entry => entry.stage === "tts-first-audio"), "the time to the first audio is still measured");
  assert.deepEqual(errors, []);
  console.log("PASS streaming reply: speaks the first sentence before the reply is finished; each sentence once; whole reply committed");
  await context.close();
} finally {
  await browser.close();
}
