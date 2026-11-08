import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 667 : 850 },
      reducedMotion: width === 768 ? "reduce" : "no-preference" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const state = createInitialState(); state.uiVersion = 4;
    state.profile = { ...state.profile, configured: true, consent: true, consentVersion: 2, name: "同步测试" };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "timeline-browser", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(s => {
      localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(s));
      window.clips = [];
      window.speechRequests = [];
      const fetchOriginal = window.fetch.bind(window);
      window.fetch = (url, options) => {
        if (url === "/api/speech") window.speechRequests.push({ text: JSON.parse(options.body).text, signal: options.signal });
        return fetchOriginal(url, options);
      };
      // Explicit start/end control verifies audio callbacks, not a guessed timeout.
      window.Audio = class {
        constructor() { window.clips.push(this); }
        async play() { this.requested = true; }
        pause() { this.paused = true; }
      };
      Object.defineProperty(window, "speechSynthesis", { value: { cancel() {}, speak(u) { u.onerror?.(); } } });
    }, state);
    await page.route("**/api/**", async route => {
      if (new URL(route.request().url()).pathname === "/api/speech") {
        await route.fulfill({ contentType: "audio/mpeg", body: Buffer.from("synthetic audio") });
      } else await route.fulfill({ contentType: "application/json", body: "{}" });
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4174/");
    await page.evaluate(() => document.querySelector("#speakReplies").checked = true);
    const send = text => page.evaluate(text => {
      document.querySelector("#childInput").value = text; document.querySelector("#askForm").requestSubmit();
    }, text);
    const ids = () => page.locator(".illustration-scene [data-object-id]").evaluateAll(nodes => nodes.map(n => n.dataset.objectId));
    await send("画房子和太阳和树");
    await page.waitForFunction(() => window.clips[0]?.requested);
    assert.deepEqual(await ids(), [], "No future scene while first audio is loading");
    await page.evaluate(() => window.clips[0].onplay());
    await page.waitForFunction(() => window.speechRequests.length === 2);
    assert.equal(await page.evaluate(() => window.clips.length), 1, "Next speech is fetched, never played early");
    assert.equal((await ids()).length, 1, "First spoken step reveals only the house");
    await page.evaluate(() => window.clips[0].onended());
    await page.waitForFunction(() => window.clips[1]?.requested);
    assert.equal(await page.evaluate(() => window.speechRequests.length), 2, "Reuse prepared speech, no duplicate request");
    assert.equal((await ids()).length, 1, "Waiting for next audio does not reveal the sun early");
    await page.evaluate(() => window.clips[1].onplay());
    assert.equal((await ids()).length, 2);
    await page.evaluate(() => window.clips[1].onended());
    await page.waitForFunction(() => window.clips[2]?.requested);
    await page.evaluate(() => window.clips[2].onplay());
    assert.equal((await ids()).length, 3);
    await page.evaluate(() => window.clips[2].onended());
    const timing = await page.evaluate(() => window.xiaoyuVoiceTimings());
    assert.equal(timing.filter(t => t.stage === "drawing-segment-gap").length, 2);
    assert.equal(timing.filter(t => t.stage === "tts-prefetch-wait").length, 2);
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const pixels = await page.evaluate(async () => {
      const svg = document.querySelector(".illustration-scene svg");
      const image = new Image(); image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, 640, 480);
      const data = ctx.getImageData(0, 0, 640, 480).data;
      let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
      return count;
    });
    assert.ok(pixels > 18000, "The actual SVG contains visible artwork");
    await page.screenshot({ path: `screenshots/drawing-timeline-${width}.png`, fullPage: true });

    // A newer command owns the canvas even when an old audio event arrives late.
    await send("重新画房子和太阳和树");
    await page.waitForFunction(() => window.clips[3]?.requested);
    await page.evaluate(() => {
      window.clips[3].onplay();
      window.prefetchSignal = window.speechRequests.at(-1).signal;
      window.lateStart = window.clips[3].onplay; window.lateEnd = window.clips[3].onended;
    });
    await send("清空画纸");
    await page.waitForFunction(() => window.clips[4]?.requested);
    assert.equal(await page.evaluate(() => window.prefetchSignal.aborted), true, "Interruption cancels unused lookahead");
    await page.evaluate(() => window.clips[4].onplay());
    assert.deepEqual(await ids(), []);
    await page.evaluate(() => { window.lateStart(); window.lateEnd(); });
    assert.deepEqual(await ids(), []);
    assert.equal(await page.evaluate(() => window.clips.length), 5);

    // Both cloud playback and browser fallback fail: finish the picture with silent steps.
    await send("画房子和太阳和树");
    await page.waitForFunction(() => window.clips[5]?.requested);
    await page.evaluate(() => window.clips[5].onerror());
    await page.waitForFunction(() => document.querySelectorAll(".illustration-scene [data-object-id]").length === 3);
    assert.equal(await page.evaluate(() => document.querySelector(".illustration-scene").dataset.step), "2");
    await page.evaluate(() => document.querySelector("#speakReplies").checked = false);
    await page.locator(".scene-replay").click();
    await page.waitForFunction(() => document.querySelector(".illustration-scene")?.dataset.step === "0");
    assert.equal((await ids()).length, 1);
    await send("清空画纸");
    await page.waitForFunction(() => document.querySelectorAll(".illustration-scene [data-object-id]").length === 0);
    await page.waitForTimeout(2600);
    assert.deepEqual(await ids(), [], "Cancelled replay timers never restore old frames");
    const motion = await page.evaluate(async () => {
      const { createDrawingScene, applyDrawingOperations } = await import("/src/whiteboard/drawingScene.js");
      const { attachDrawingPresentation } = await import("/src/whiteboard/drawingTimeline.js");
      const { createIllustrationScene } = await import("/src/ui/illustrationScene.js");
      const seed = createDrawingScene("motion-fixture");
      const before = applyDrawingOperations(seed, { baseRevision: 1, operations: [
        { op: "add", kind: "house", count: 2 }, { op: "connect", from: "object-1", to: "object-2" }
      ] }).scene;
      const ops = [{ op: "move", id: "object-1", direction: "right" }];
      const after = applyDrawingOperations(before, { baseRevision: before.revision, operations: ops }).scene;
      const plan = attachDrawingPresentation(before, ops, after);
      const host = document.createElement("div"); document.body.append(host);
      const player = createIllustrationScene(host, plan);
      // Drive a known intermediate time: two real RAFs may exceed 360ms on a busy/locked desktop.
      const originalRequest = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
      const frames = new Map(); let nextFrame = 1;
      window.requestAnimationFrame = callback => { const id = nextFrame++; frames.set(id, callback); return id; };
      window.cancelAnimationFrame = id => frames.delete(id);
      try {
        player.prepare(); player.step(0);
        const callback = frames.values().next().value;
        frames.clear();
        if (callback) callback(performance.now() + 80);
        const x = Number(host.querySelector('[data-object-id="object-1"]').style.transform.match(/translate\(([\d.]+)/)[1]);
        const roadX = Number(host.querySelector('[data-subject="path"] path').getAttribute("d").match(/^M([\d.]+)/)[1]);
        player.stop();
        const cancelled = frames.size === 0;
        const settled = host.querySelector('[data-object-id="object-1"]').style.transform;
        await new Promise(resolve => setTimeout(resolve, 400));
        const stable = host.querySelector('[data-object-id="object-1"]').style.transform === settled;
        return { x, roadX, settled, stable, cancelled };
      } finally {
        window.requestAnimationFrame = originalRequest;
        window.cancelAnimationFrame = originalCancel;
        player.destroy(); host.remove();
      }
    });
    assert.ok(Math.abs(motion.x - motion.roadX) < 0.01, "Road endpoint follows the same frame (CSS serialization rounds coordinates)");
    if (width !== 768) assert.ok(motion.x > 126 && motion.x < 514, "Movement has intermediate frames");
    else assert.equal(motion.x, 514);
    assert.match(motion.settled, /translate\(514px/); assert.ok(motion.stable); assert.ok(motion.cancelled);
    assert.deepEqual(errors, []);
    console.log(`${width}px: audio-gated frames, interruption, silent fallback/replay, reduced motion, visible artwork passed`);
    await context.close();
  }
} finally { await browser.close(); }
