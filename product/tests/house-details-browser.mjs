import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
import { validateDrawingPlan } from "../server/drawingPlanner.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 667 : 850 }, reducedMotion: width === 768 ? "reduce" : "no-preference" });
    const page = await context.newPage(), errors = [], calls = [];
    page.on("pageerror", e => errors.push(e.message));
    const state = createInitialState(); state.uiVersion = 4;
    state.profile = { ...state.profile, configured: true, consent: true, name: "细部测试" };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "house-details", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(s => {
      if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(s));
    }, state);
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/whiteboard/plan") {
        calls.push(path);
        const payload = route.request().postDataJSON(), s = payload.board.scene;
        const accepted = validateDrawingPlan({ baseRevision: s.revision, operations: [
          { op: "update", id: s.objects[0].id, patch: { windowShape: "square", windowCount: 2 } },
          { op: "update", id: s.objects[0].id, patch: { doorColor: "#df837a" } }
        ] }, s, payload.input);
        assert.ok(accepted);
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ sourceRevision: s.revision,
          plan: { board: { type: "scene", scene: accepted.scene }, reply: accepted.reply, segments: accepted.scene.steps, changed: true },
          llmStatus: { used: true, stage: "drawing-plan" } }) });
      } else {
        if (path.startsWith("/api/tutor")) calls.push(path);
        await route.fulfill({ contentType: "application/json", body: "{}" });
      }
    });
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")));
    const send = async text => {
      const count = (await saved()).session.turnCount;
      await page.evaluate(text => { document.querySelector("#childInput").value = text; document.querySelector("#askForm").requestSubmit(); }, text);
      await page.waitForFunction(count => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.turnCount > count, count);
    };
    await page.goto(process.env.TEST_URL || "http://localhost:4174/");
    await page.evaluate(() => document.querySelector("#speakReplies").checked = false);
    await send("画两座房子");
    await page.evaluate(() => { window.savedHouseBody = document.querySelector('[data-object-id="object-2"] [data-part="body"]'); });
    await send("把窗户改成圆形");
    await send("右边的");
    const house = page.locator('[data-object-id="object-2"]');
    assert.match(await house.locator('[data-part="window-0"]').getAttribute("data-geometry"), /a11/);
    await send("给右边房子加两扇窗户");
    assert.equal(await house.locator('[data-part^="window-"]').count(), 4);
    await send("把右边房子的窗户涂成紫色");
    await send("把右边房子的门改成长方形");
    await send("把右边房子的门涂成蓝色");
    assert.ok(await page.evaluate(() => window.savedHouseBody === document.querySelector('[data-object-id="object-2"] [data-part="body"]')), "Unchanged house body keeps its DOM identity");
    assert.equal(await page.locator('[data-object-id="object-1"] [data-part^="window-"]').count(), 2);
    assert.equal(await house.locator('[data-part="door"]').getAttribute("data-geometry"), "M-17 0 L-17 -60 L17 -60 L17 0 Z");
    const pixels = await page.evaluate(async () => {
      const svg = document.querySelector(".illustration-scene > svg"), img = new Image();
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
      try {
        img.src = url; await img.decode();
        const c = document.createElement("canvas"); c.width = 640; c.height = 480;
        const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, 640, 480);
        const d = ctx.getImageData(0, 0, 640, 480).data;
        let purple = 0, blue = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 200) continue;
          if (Math.abs(d[i] - 181) < 3 && Math.abs(d[i + 1] - 160) < 3 && Math.abs(d[i + 2] - 191) < 3) purple++;
          if (Math.abs(d[i] - 135) < 3 && Math.abs(d[i + 1] - 187) < 3 && Math.abs(d[i + 2] - 201) < 3) blue++;
        }
        return { purple, blue };
      } finally { URL.revokeObjectURL(url); }
    });
    assert.ok(pixels.purple > 500 && pixels.blue > 500, JSON.stringify(pixels));
    await page.screenshot({ path: `screenshots/house-details-${width}.png`, fullPage: true });
    assert.ok(await page.locator("#childWhiteboardPanel").isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.evaluate(() => {
      const svg = document.querySelector(".illustration-scene > svg").getBoundingClientRect();
      return [...document.querySelectorAll('[data-object-id]')].every(g => {
        const b = g.getBoundingClientRect();
        return b.left >= svg.left - 2 && b.right <= svg.right + 2 && b.top >= svg.top - 2 && b.bottom <= svg.bottom + 2;
      });
    }));
    const detailed = (await saved()).board.scene;
    await send("去掉右边房子的窗户");
    assert.equal(await house.locator('[data-part^="window-"]').count(), 0);
    await send("撤销");
    assert.equal(await house.locator('[data-part^="window-"]').count(), 4);
    assert.deepEqual((await saved()).board.scene.objects, detailed.objects);
    assert.deepEqual(calls, [], "Simple details execute locally without a model");
    await send("把左边房子改成两扇方窗，然后把门涂红色");
    await page.waitForFunction(() => [...document.querySelectorAll('[data-object-id="object-1"] [data-part="door"] path')].some(p => p.getAttribute("fill") === "#df837a"));
    assert.deepEqual(calls, ["/api/whiteboard/plan"]);
    await send("撤销");
    assert.deepEqual((await saved()).board.scene.objects, detailed.objects);
    await page.reload();
    assert.deepEqual((await saved()).board.scene.objects, detailed.objects);
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1")));
    assert.ok(db.growthMoments.some(m => m.boardSnapshot?.scene?.objects?.some(o => o.windowCount === 4 && o.windowShape === "round")));
    assert.deepEqual(errors, []);
    console.log(`${width}px: house parts, visible colour pixels, stable body, count, clarification, compound timeline, undo and local restore passed`);
    await context.close();
  }
} finally { await browser.close(); }
