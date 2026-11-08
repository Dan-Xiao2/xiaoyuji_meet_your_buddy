import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
import { createDrawingScene } from "../src/whiteboard/drawingScene.js";
import { validateDrawingPlan } from "../server/drawingPlanner.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage(), errors = [], calls = [];
    page.on("pageerror", e => errors.push(e.message));
    const state = createInitialState(); state.uiVersion = 4;
    state.profile = { ...state.profile, configured: true, consent: true, consentVersion: 2, name: "模型测试" };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "planner-browser", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(s => localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(s)), state);
    let release, mode = "success";
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/whiteboard/plan") {
        const payload = route.request().postDataJSON(); calls.push(path);
        assert.equal(payload.state, undefined, "Do not send household/archive state");
        const s = payload.board.scene || createDrawingScene("model-scene");
        const operation = s.objects.length ? [{ op: "update", id: s.objects[0].id, patch: { scale: 0.8 } }] : [
          { op: "add", kind: "house", count: 3 },
          { op: "update", id: "object-1", patch: { scale: 0.7 } },
          { op: "update", id: "object-3", patch: { scale: 1.2 } }
        ];
        const accepted = validateDrawingPlan({ baseRevision: s.revision, operations: operation }, s, payload.input);
        if (mode === "hold") await new Promise(resolve => { release = resolve; });
        const scene = { ...accepted.scene, steps: [{ text: accepted.reply }] };
        const result = mode === "failure" ? { plan: null, llmStatus: { fallback: true } } : {
          sourceRevision: payload.board.scene?.revision ?? null,
          plan: { board: { type: "scene", scene }, reply: accepted.reply, segments: scene.steps, changed: true },
          llmStatus: { provider: "qwen", used: true, stage: "drawing-plan" }
        };
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) }).catch(() => {});
      } else {
        if (path.startsWith("/api/tutor")) calls.push(path);
        await route.fulfill({ contentType: "application/json", body: "{}" });
      }
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4174/");
    await page.evaluate(() => document.querySelector("#speakReplies").checked = false);
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")));
    const send = text => page.evaluate(text => {
      document.querySelector("#childInput").value = text; document.querySelector("#askForm").requestSubmit();
    }, text);
    await send("画三座高矮不同的房子");
    await page.waitForSelector('[data-object-id="object-3"]');
    assert.deepEqual((await saved()).board.scene.objects.map(o => o.scale), [0.7, 1, 1.2]);
    assert.deepEqual(calls, ["/api/whiteboard/plan"], "One planner call, no independent quick/full narration");
    const board = (await saved()).board;
    mode = "failure";
    await send("让右边那一座更小一些");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).llmStatus.fallback === true);
    assert.deepEqual((await saved()).board.scene.objects, board.scene.objects);
    mode = "hold";
    await send("让右边那一座更小一些");
    while (!release) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await page.locator('[data-subject="house"]').count(), 3, "Keep old drawing visible while planning");
    await send("把右边房子的屋顶涂成蓝色");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).board.scene.objects[2].roofColor === "#87bbc9");
    const latest = (await saved()).board;
    release(); await page.waitForTimeout(250);
    assert.deepEqual((await saved()).board, latest, "Late model plan must not overwrite newer local edits");
    assert.deepEqual(errors, []);
    console.log(`${width}px: single model request, existing board during wait, fallback and stale response cancellation passed`);
    await context.close();
  }
} finally { await browser.close(); }
