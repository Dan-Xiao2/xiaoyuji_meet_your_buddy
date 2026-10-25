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
    state.profile = { ...state.profile, name: "测试孩子", configured: true, consent: true };
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
    let tutorCalls = 0;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let result = {};
      if (path.startsWith("/api/tutor")) {
        tutorCalls++;
        const payload = route.request().postDataJSON();
        result = path.endsWith("/quick") ? { reply: "你想知道恐龙的什么呢？" } :
          { ...payload.state, board: { type: "science", variant: "moon", items: ["太阳", "地球", "月亮"] } };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4174/");
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
    await page.locator(".scene-replay").click();
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      document.querySelector("#childInput").value = "那恐龙呢";
      document.querySelector("#askForm").requestSubmit();
    });
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).llmStatus?.enrichmentPending);
    await page.waitForTimeout(1400);
    assert.equal(await page.locator(".block-scene").count(), 0, "Replay cannot restore a stale scene after changing topic");
    assert.equal(await page.locator("#childWhiteboardPanel").isVisible(), false, "Unrelated model moon drawing is rejected");
    assert.equal((await readDb()).growthMoments.length, 4, "Replay and taps create no invented growth records");
    assert.equal((await readDb()).growthMoments[0].boardSnapshot.type, "blank");
    await page.locator("#endChildSession").click();
    const starts = await page.evaluate(() => window.recognitionStarts);
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => window.recognitionStarts), starts);
    assert.deepEqual(errors, []);
    console.log(`${width}px: scene/speech timing, object identity, taps, replay cancellation, relevance, archive and layout passed`);
    await context.close();
  }
} finally { await browser.close(); }
