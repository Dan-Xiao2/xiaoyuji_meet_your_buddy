import { waitForConversationPhase } from "./helpers/runtimeDiagnostics.mjs";
import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true, args: ["--autoplay-policy=no-user-gesture-required"],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
});
try {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: width === 768 ? "reduce" : "no-preference" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = createInitialState();
    state.uiVersion = 4;
    state.profile = { ...state.profile, name: "测试孩子", configured: true, consent: true, consentVersion: 2 };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "board-test", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(state => {
      localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(state));
      navigator.mediaDevices.getUserMedia = async () => { throw new Error("No physical microphone in tests"); };
      window.recognitionStarts = 0;
      window.SpeechRecognition = class {
        start() { window.currentRecognition = this; window.recognitionStarts++; this.onstart?.(); }
        abort() {}
        stop() {}
      };
      window.emitSpeech = text => {
        const r = window.currentRecognition;
        const result = [{ transcript: text }]; result.isFinal = true;
        r.onresult({ resultIndex: 0, results: [result] }); r.onend();
      };
      window.spokenSteps = [];
      const original = window.fetch.bind(window);
      window.fetch = async (url, options) => {
        if (url !== "/api/speech/stream") return original(url, options);
        window.spokenSteps.push(JSON.parse(options.body).text);
        // Silent PCM exercises actual audio scheduling, never an external API.
        return new Response(new Uint8Array(48000), { headers: { "content-type": "audio/pcm" } });
      };
    }, state);
    let tutorCalls = 0, releaseEnrichment;
    const unexpected = [];
    const enrichmentStarted = new Promise(resolve => { releaseEnrichment = { started: resolve }; });
    const enrichmentGate = new Promise(resolve => { releaseEnrichment.finish = resolve; });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let result;
      if (path === "/api/voice-status") result = {};
      else if (path === "/api/speech") {
        // Disable MP3 prefetch explicitly; the synthetic PCM stream remains the playback source.
        await route.fulfill({ status: 503, body: "Test uses streaming PCM" });
        return;
      }
      else if (path === "/api/tutor/quick" || path === "/api/tutor/quick/stream" || path === "/api/tutor") {
        tutorCalls++;
        const payload = route.request().postDataJSON();
        assert.equal(payload.input, "那恐龙呢");
        if (path.endsWith("/quick")) result = { reply: "你想知道恐龙的什么呢？", llmStatus: { used: true } };
        else if (path.endsWith("/stream")) {
          // The page asks for the reply sentence by sentence; answer in that format.
          const reply = "你想知道恐龙的什么呢？";
          await route.fulfill({ contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "sentence", text: reply })}\n${JSON.stringify({ type: "done", reply, llmStatus: { used: true } })}\n` });
          return;
        }
        else {
          releaseEnrichment.started();
          await enrichmentGate;
          result = { board: { type: "science", variant: "moon", items: ["太阳", "地球", "月亮"] },
            growthEvidence: { shouldSave: true, sourceQuote: payload.input, topics: ["恐龙"], observation: "孩子提到了恐龙。", inference: "" },
            llmStatus: { used: true, model: "test-model" } };
        }
      } else {
        unexpected.push(path);
        await route.fulfill({ status: 500, body: "Unexpected test request" });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4174/");
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    assert.equal(await page.locator("#childWhiteboardPanel").isVisible(), false);
    await page.locator("#mainVoiceButton").click();
    await page.waitForFunction(() => window.recognitionStarts === 1);
    await page.evaluate(() => window.emitSpeech("我有五块积木，给爸爸两块"));
    await page.waitForFunction(() => window.spokenSteps.length === 1 && document.querySelector(".block-scene")?.dataset.given === "0");
    await page.waitForFunction(() => window.Konva.stages.filter(Boolean)[0]?.find("#block-4").length === 1);
    await page.evaluate(() => {
      window.firstStage = window.Konva.stages.filter(Boolean)[0];
      window.firstBlock = window.firstStage.findOne("#block-4");
      window.firstLocation = window.firstBlock.position();
      window.firstCanvas = document.querySelector(".block-scene canvas");
    });
    await page.waitForFunction(() => document.querySelector(".block-scene")?.dataset.given === "2");
    const moving = await page.evaluate(() => window.firstBlock.position());
    await page.waitForTimeout(620);
    const final = await page.evaluate(() => window.firstBlock.position());
    assert.notDeepEqual(final, await page.evaluate(() => window.firstLocation));
    if (width !== 768) assert.notDeepEqual(moving, final, "Object moves across frames, not a static replacement");
    assert.equal(await page.locator(".scene-replay svg").count(), 1);
    assert.equal(tutorCalls, 0, "The bounded shared plan needs no independent model drawing request");
    const pixelCount = await page.evaluate(() => {
      const c = document.querySelector(".block-scene canvas");
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
      return count;
    });
    assert.ok(pixelCount > 5000, "Canvas contains visible objects");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow");
    const blockPoint = await page.evaluate(() => {
      const rect = document.querySelector(".block-scene canvas").getBoundingClientRect();
      const node = window.firstStage.findOne("#block-0");
      return { x: rect.left + node.x() + 20, y: rect.top + node.y() + 28 };
    });
    await page.mouse.click(blockPoint.x, blockPoint.y);
    assert.equal(await page.locator(".block-scene-count").textContent(), "数到 1 块");
    await page.screenshot({ path: `screenshots/whiteboard-blocks-${width}.png`, fullPage: true });
    if (width === 390) {
      await page.setViewportSize({ width, height: 667 });
      await page.waitForTimeout(100);
      assert.ok(await page.evaluate(() => {
        const canvas = document.querySelector(".block-scene canvas").getBoundingClientRect();
        const mic = document.querySelector("#mainVoiceButton").getBoundingClientRect();
        return window.firstStage.find("Group").filter(node => node.id().startsWith("block-")).every(node => {
          const left = canvas.left + node.x(), top = canvas.top + node.y();
          return top + 52 <= innerHeight && (left + 50 <= mic.left || left >= mic.right || top + 52 <= mic.top || top >= mic.bottom);
        });
      }), "Short phone: objects stay visible and clear of the voice button");
      await page.screenshot({ path: "screenshots/whiteboard-blocks-short-phone.png", fullPage: true });
      await page.setViewportSize({ width, height: 900 });
    }
    await page.waitForFunction(() => window.recognitionStarts >= 2);
    await page.evaluate(() => window.emitSpeech("再给爸爸一块"));
    await page.waitForFunction(() => document.querySelector(".block-scene")?.dataset.given === "3");
    assert.ok(await page.evaluate(() => window.firstCanvas === document.querySelector(".block-scene canvas") && window.firstBlock === window.firstStage.findOne("#block-4")));
    await page.waitForFunction(() => window.recognitionStarts >= 3);
    await page.evaluate(() => window.emitSpeech("拿回一块"));
    await page.waitForFunction(() => document.querySelector(".block-scene")?.dataset.given === "2");
    await page.waitForFunction(() => window.recognitionStarts >= 4);
    const readDb = () => page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1")));
    assert.equal((await readDb()).growthMoments.length, 3);
    assert.equal((await readDb()).growthMoments[0].boardSnapshot.scene.given, 2);
    const retainedBoard = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).board);
    const spokenBeforeReplay = await page.evaluate(() => window.spokenSteps.length);
    await page.locator(".scene-replay").click();
    await page.waitForFunction(() => document.querySelector(".block-scene")?.dataset.given === "3");
    await page.evaluate(() => {
      document.querySelector("#childInput").value = "那恐龙呢";
      document.querySelector("#askForm").requestSubmit();
    });
    await Promise.race([enrichmentStarted, new Promise((_, reject) => setTimeout(() => reject(new Error("Enrichment never started")), 5000))]);
    const quickMoment = (await readDb()).growthMoments[0];
    assert.equal(quickMoment.childQuote, "那恐龙呢");
    assert.equal(quickMoment.domain, "language", "Quick reply must not inherit the displayed math scene");
    assert.equal(quickMoment.lessonTitle, "");
    assert.equal(quickMoment.boardSnapshot, null);
    assert.ok(!quickMoment.topics.includes(retainedBoard.title));
    releaseEnrichment.finish();
    await waitForConversationPhase(page, "complete");
    await page.waitForTimeout(1400);
    assert.equal(tutorCalls, 2, "Both quick reply and forbidden-board enrichment actually execute");
    assert.equal(await page.locator(".block-scene").count(), 1, "Chat may keep the accepted scene visible");
    assert.equal(await page.locator("#childWhiteboardPanel").isVisible(), true);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).board), retainedBoard,
      "Enrichment must not publish its unrelated moon drawing");
    assert.equal(await page.locator(".block-scene").getAttribute("data-given"), "3", "Cancelled visual replay cannot advance its scheduled second step");
    assert.deepEqual(await page.evaluate(n => window.spokenSteps.slice(n), spokenBeforeReplay), ["你想知道恐龙的什么呢？"],
      "After interrupting replay, only the new answer may be spoken");
    assert.equal((await readDb()).growthMoments.length, 4, "Replay and taps create no invented growth records");
    assert.equal((await readDb()).growthMoments[0].boardSnapshot, null);
    const enrichedMoment = (await readDb()).growthMoments[0];
    assert.equal(enrichedMoment.id, quickMoment.id);
    assert.equal(enrichedMoment.revision, quickMoment.revision + 1);
    assert.equal(enrichedMoment.domain, "language");
    assert.equal(enrichedMoment.lessonTitle, "");
    assert.deepEqual(enrichedMoment.topics, ["恐龙"]);
    await page.locator("#endChildSession").click();
    const starts = await page.evaluate(() => window.recognitionStarts);
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => window.recognitionStarts), starts);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log(`${width}px: scene/speech timing, object identity, taps, replay cancellation, relevance, archive and layout passed`);
    await context.close();
  }
} finally { await browser.close(); }
