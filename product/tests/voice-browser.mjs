import { waitForConversationPhase } from "./helpers/runtimeDiagnostics.mjs";
import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
import { createTutorTurn } from "../src/services/tutorEngine.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
});
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = createInitialState();
    state.uiVersion = 4;
    state.profile = { ...state.profile, name: "测试孩子", configured: true, consent: true };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "voice-test", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(state => {
      localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(state));
      window.recognitionStarts = 0;
      // No physical microphone, personal audio or external API is used.
      navigator.mediaDevices.getUserMedia = async () => { throw new Error("Test microphone disabled"); };
      window.SpeechRecognition = class {
        start() { window.currentRecognition = this; window.recognitionStarts++; this.onstart?.(); }
        abort() {}
        stop() {}
      };
      window.emitSpeech = text => {
        const recognition = window.currentRecognition;
        const result = [{ transcript: text }]; result.isFinal = true;
        recognition.onresult({ resultIndex: 0, results: [result] });
        recognition.onend();
      };
      window.streamMode = "normal";
      window.streamRequests = 0;
      window.finishedStream = false;
      const fetchOriginal = window.fetch.bind(window);
      window.fetch = async (url, options) => {
        if (url !== "/api/speech/stream") return fetchOriginal(url, options);
        window.streamRequests++;
        if (window.streamMode === "unavailable") return new Response("", { status: 503 });
        const mode = window.streamMode;
        window.finishedStream = false;
        return new Response(new ReadableStream({
          start(controller) {
            let closed = false;
            const timer = setTimeout(() => {
              if (closed) return;
              closed = true;
              if (mode === "broken") controller.error(new Error("Interrupted stream"));
              else { window.finishedStream = true; controller.close(); }
            }, 450);
            options.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              if (!closed) { closed = true; controller.error(new DOMException("Aborted", "AbortError")); }
            }, { once: true });
            // One second of silent PCM exercises real Web Audio scheduling.
            controller.enqueue(new Uint8Array(48000));
          }
        }), { headers: { "content-type": "audio/pcm", "X-Voice-Latency-Ms": "5" } });
      };
    }, state);
    let completedFull = 0;
    const inputs = [];
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let result = {};
      if (path === "/api/tutor/quick") {
        const payload = route.request().postDataJSON();
        inputs.push(payload);
        result = { reply: "这是测试回答：" + payload.input, llmStatus: { used: true } };
      } else if (path === "/api/tutor") {
        const payload = route.request().postDataJSON();
        await new Promise(resolve => setTimeout(resolve, payload.input === "我想画画" ? 4000 : 150));
        result = createTutorTurn(payload.input, payload.state);
        completedFull++;
      } else if (path === "/api/speech") {
        await route.fulfill({ status: 503, body: "" }); return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) }).catch(() => {});
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4174/");
    await page.locator("#mainVoiceButton").click();
    await page.waitForFunction(() => window.recognitionStarts === 1);
    await page.evaluate(() => window.emitSpeech("我想画画"));
    await page.waitForFunction(() => document.querySelector(".child-voice-dock").dataset.voicePhase === "speaking");
    assert.equal(await page.evaluate(() => window.finishedStream), false, "Playback begins before download finishes");
    await page.waitForFunction(() => window.recognitionStarts >= 2);
    assert.equal(completedFull, 0, "Auto-listen must not wait for the full whiteboard response");
    const readDb = () => page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1")));
    assert.equal((await readDb()).growthMoments.length, 1, "Save the first turn before it can be interrupted");
    await page.evaluate(() => window.emitSpeech("我喜欢蓝色"));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.turnCount === 2);
    await waitForConversationPhase(page, "complete");
    await page.waitForFunction(() => window.recognitionStarts >= 3);
    await page.locator("#endChildSession").click();
    const listenCount = await page.evaluate(() => window.recognitionStarts);
    await page.waitForTimeout(4100);
    assert.equal(await page.evaluate(() => window.recognitionStarts), listenCount, "Ending a session prevents re-listening");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")));
    assert.equal(saved.session.status, "ended");
    assert.equal(saved.session.turnCount, 2);
    assert.equal((await readDb()).growthMoments.length, 2, "Enrichment must not duplicate records");
    assert.equal(saved.messages.at(-1).text, "这是测试回答：我喜欢蓝色", "Late first-turn result cannot overwrite the second");
    assert.ok(!inputs[0].state.messages.some(message => message.role === "tutor"), "No invented tutor history");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `screenshots/voice-latency-${width}.png` });

    // Controller-level cancellation and partial-stream failure, with real AudioContext.
    await page.evaluate(async () => {
      const { createVoiceController } = await import("/src/services/voiceService.js");
      window.testVoice = createVoiceController();
      window.testVoice.preparePlayback();
      window.voiceEvents = [];
      window.testVoice.speak("测试停止", {
        onStart: () => window.voiceEvents.push("start"),
        onEnd: () => window.voiceEvents.push("end"),
        onError: () => window.voiceEvents.push("error")
      });
    });
    await page.waitForFunction(() => window.voiceEvents.includes("start"));
    await page.evaluate(() => window.testVoice.stopSpeaking());
    await page.waitForTimeout(1100);
    assert.deepEqual(await page.evaluate(() => window.voiceEvents), ["start"]);
    await page.evaluate(() => {
      window.streamMode = "broken";
      window.voiceEvents = [];
      window.testVoice.speak("测试断流", {
        onStart: () => window.voiceEvents.push("start"),
        onEnd: () => window.voiceEvents.push("end"),
        onError: () => window.voiceEvents.push("error"),
        onTiming: timing => { if (timing.stage === "tts-stream-fallback") window.voiceEvents.push("fallback"); }
      });
    });
    await page.waitForFunction(() => window.voiceEvents.includes("error"));
    assert.deepEqual(await page.evaluate(() => window.voiceEvents), ["start", "error"], "Do not replay an already spoken prefix after stream failure");
    await page.evaluate(() => {
      window.streamMode = "unavailable";
      window.voiceEvents = [];
      window.systemSpeechCalls = 0;
      window.speechSynthesis.speak = () => { window.systemSpeechCalls++; };
      window.testVoice.speak("测试降级", {
        onStart: () => window.voiceEvents.push("start"),
        onEnd: () => window.voiceEvents.push("end"),
        onError: () => window.voiceEvents.push("error"),
        onTiming: timing => { if (timing.stage === "tts-stream-fallback") window.voiceEvents.push("fallback"); }
      });
    });
    await page.waitForFunction(() => window.voiceEvents.includes("error"));
    assert.deepEqual(await page.evaluate(() => window.voiceEvents), ["fallback", "error"]);
    assert.equal(await page.evaluate(() => window.systemSpeechCalls), 0, "Failed cloud audio must not switch to an unrelated system voice");
    assert.deepEqual(errors, []);
    console.log(`${width}px: early playback, auto-listen before enrichment, turn persistence, stale results, session end, cancellation and partial failure passed`);
    await context.close();
  }
} finally { await browser.close(); }
