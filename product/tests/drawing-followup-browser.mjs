import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage(), errors = [], modelRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = createInitialState(); state.uiVersion = 4;
    state.profile = { ...state.profile, configured: true, consent: true, name: "绘画测试" };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "followup-test", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(s => {
      localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(s));
      navigator.mediaDevices.getUserMedia = async () => { throw new Error("Synthetic recognition only"); };
      window.recognitionStarts = 0;
      window.SpeechRecognition = class {
        start() { window.recognition = this; window.recognitionStarts++; this.onstart?.(); }
        stop() {} abort() {}
      };
      window.emitSpeech = text => {
        const r = window.recognition, result = [{ transcript: text }]; result.isFinal = true;
        r.onresult({ resultIndex: 0, results: [result] }); r.onend();
      };
      let first = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (url, options) => {
        if (url !== "/api/speech/stream") return originalFetch(url, options);
        if (first) {
          first = false;
          return new Response(new ReadableStream({ start(controller) {
            window.releaseFirstAudio = () => { controller.enqueue(new Uint8Array(4800)); controller.close(); };
          } }), { headers: { "content-type": "audio/pcm" } });
        }
        return new Response(new Uint8Array(4800), { headers: { "content-type": "audio/pcm" } });
      };
    }, state);
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/tutor") || path === "/api/whiteboard/plan") modelRequests.push(path);
      await route.fulfill({ contentType: "application/json", body: "{}" });
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4174/");
    await page.locator("#mainVoiceButton").click();
    await page.waitForFunction(() => window.recognitionStarts === 1);
    await page.evaluate(() => window.emitSpeech("你可以画一个房子吗？"));
    await page.waitForFunction(() => Boolean(window.releaseFirstAudio));
    assert.ok(await page.locator("#childWhiteboardPanel").isVisible(), "The first drawing is visible even before any audio packet");
    assert.equal(await page.locator('[data-subject="house"]').count(), 1);
    await page.evaluate(() => window.releaseFirstAudio());
    await page.waitForFunction(() => window.recognitionStarts >= 2);
    const phrases = ["，我想要一个紫色顶的房子。", "嗯。", "发给我看吧。", "好好。", "我怎么没有看到？", "嗯。"];
    for (let i = 0; i < phrases.length; i++) {
      await page.evaluate(text => window.emitSpeech(text), phrases[i]);
      await page.waitForFunction(count => window.recognitionStarts >= count, i + 3);
      assert.ok(await page.locator("#childWhiteboardPanel").isVisible(), phrases[i]);
      const drawing = await page.evaluate(() => ({
        objects: document.querySelectorAll('.illustration-scene [data-object-id]').length,
        fills: [...document.querySelectorAll('.illustration-scene [data-part="roof"] path')].map(n => n.getAttribute("fill")),
        messages: document.querySelector("#messageList").textContent
      }));
      assert.equal(drawing.objects, 1, phrases[i]);
      assert.ok(drawing.fills.includes("#b5a0bf"), "The visible roof, not only saved JSON, must be purple");
      assert.doesNotMatch(drawing.messages, /圆圆门|门变大|窗户/);
    }
    for (const [i, text] of ["再加两扇窗户", "把窗户改成圆形", "紫色", "把门改成长方形", "改成蓝色"].entries()) {
      await page.evaluate(text => window.emitSpeech(text), text);
      await page.waitForFunction(count => window.recognitionStarts >= count, phrases.length + i + 3);
      assert.ok(await page.locator("#childWhiteboardPanel").isVisible());
    }
    assert.equal(await page.locator('.illustration-scene [data-part^="window-"]').count(), 4);
    assert.match(await page.locator('.illustration-scene [data-part="window-0"]').getAttribute("data-geometry"), /a11/);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.illustration-scene [data-part="window-0"] path')].some(p => p.getAttribute("fill") === "#b5a0bf")));
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.illustration-scene [data-part="door"] path')].some(p => p.getAttribute("fill") === "#87bbc9")));
    assert.deepEqual(modelRequests, [], "Colour and detail followups must not fall into ordinary LLM chat");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `screenshots/drawing-followup-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`${width}px: voice-controller path, pre-audio drawing, visible roof, six natural followups, five house-detail edits and auto-listen passed`);
    await context.close();
  }
} finally { await browser.close(); }
