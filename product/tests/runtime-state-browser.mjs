import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { waitForConversationPhase, readRuntimeDiagnostics } from "./helpers/runtimeDiagnostics.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const key = "xiaoyuji-learning-state-v1";
try {
  for (const width of [390, 1440]) for (const mode of ["playing", "capturing", "failure"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), quick = deferred(), enrichment = deferred(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = createInitialState();
    state.uiVersion = 4;
    state.profile = { ...state.profile, name: "模拟状态家庭", consent: true, configured: true, consentVersion: 2 };
    state.session = { id: "runtime-test", status: "active", turnCount: 0 };
    await page.addInitScript(({ state, key }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
      // Controlled media callbacks exercise the real app/service boundary, without hardware or audio claims.
      window.AudioContext = undefined; window.webkitAudioContext = undefined;
      window.audioInstances = []; window.recognitionStarts = 0;
      window.Audio = class {
        constructor() { window.audioInstances.push(this); }
        play() { return Promise.resolve(); }
        pause() {}
      };
      navigator.mediaDevices.getUserMedia = async () => { throw new Error("Synthetic microphone"); };
      window.SpeechRecognition = class {
        start() { window.recognition = this; window.recognitionStarts++; this.onstart?.(); }
        stop() {} abort() {}
      };
      window.emitUtterance = text => {
        const result = [{ transcript: text }]; result.isFinal = true;
        window.recognition.onresult({ resultIndex: 0, results: [result] });
        window.recognition.onend();
      };
    }, { state, key });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/tutor/quick") {
        await quick.promise;
        return route.fulfill({ json: { reply: "你发现了叶子呀。", llmStatus: { used: true, model: "fake-quick", stage: "quick-reply", pending: true } } });
      }
      if (path === "/api/tutor") {
        await enrichment.promise;
        return route.fulfill({ json: { memory: { interests: ["叶子"] }, llmStatus: { used: true, model: "fake-enrichment", stage: "complete" } } });
      }
      if (path === "/api/speech") return route.fulfill({ contentType: "audio/mpeg", body: "synthetic" });
      return route.fulfill({ json: {} });
    });
    const phase = () => page.locator(".child-voice-dock").getAttribute("data-voice-phase");
    const waitPhase = wanted => page.waitForFunction(wanted => document.querySelector(".child-voice-dock").dataset.voicePhase === wanted, wanted);
    try {
      await page.goto(process.env.TEST_URL || "http://127.0.0.1:4197/");
      await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
      await page.locator("#mainVoiceButton").click();
      await waitPhase("listening");
      await page.evaluate(() => window.emitUtterance("今天发现一片叶子"));
      await waitForConversationPhase(page, "quick");
      await waitPhase("thinking");
      assert.equal(await page.locator("#mainVoiceButton").isDisabled(), true);
      quick.resolve();
      await waitForConversationPhase(page, "enrichment");
      await page.waitForFunction(() => window.audioInstances.length === 1);
      assert.equal(await phase(), "thinking", "Prepared speech still blocks listening before playback starts");
      await page.evaluate(() => {
        const a = window.audioInstances[0];
        window.oldAudioCallbacks = { play: a.onplay, end: a.onended, error: a.onerror };
        a.onplay();
      });
      await waitPhase("speaking");
      if (mode === "capturing") {
        await page.evaluate(() => window.audioInstances[0].onended());
        await waitPhase("listening");
        assert.equal(await page.evaluate(() => window.recognitionStarts), 2, "Enrichment must not block resumed capture");
      }
      if (mode === "failure") {
        await page.evaluate(() => window.audioInstances[0].onerror());
        await waitPhase("retry");
      }
      const expected = { playing: "speaking", capturing: "listening", failure: "retry" }[mode];
      enrichment.resolve();
      await waitForConversationPhase(page, "complete");
      assert.equal(await phase(), expected, "A business render must not overwrite the media owner's state");
      assert.equal(await page.locator("#mainVoiceButton").isDisabled(), false);
      const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
      for (const field of ["pending", "enrichmentPending", "stage", "message"]) assert.equal(persisted.llmStatus[field], undefined);
      assert.equal(persisted.llmStatus.model, "fake-enrichment");
      assert.equal(persisted.messages.at(-1).text, "你发现了叶子呀。");
      if (mode === "failure") {
        await page.locator("#mainVoiceButton").click();
        await waitPhase("listening");
      }
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
        window.oldAudioCallbacks.play(); window.oldAudioCallbacks.end(); window.oldAudioCallbacks.error();
      });
      await waitPhase("ready");
      const stopped = (await readRuntimeDiagnostics(page)).snapshots;
      assert.equal(stopped.media.input, "idle"); assert.equal(stopped.media.output, "idle");
      assert.equal(stopped.media.autoListen, false);
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
      assert.equal((await readRuntimeDiagnostics(page)).snapshots.conversation.phase, "idle");
      assert.equal(await phase(), "ready");
      assert.equal(await page.evaluate(() => window.recognitionStarts), 0);
      assert.equal(await page.evaluate(() => window.audioInstances.length), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS runtime UI ${width}px/${mode}: preparation, enrichment isolation, retry, stop, reload`);
    } finally { quick.resolve(); enrichment.resolve(); await context.close(); }
  }
} finally { await browser.close(); }
