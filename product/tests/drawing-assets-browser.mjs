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
    state.profile = { ...state.profile, configured: true, consent: true, consentVersion: 2, name: "素材测试" };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "asset-test", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(s => {
      if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(s));
    }, state);
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/whiteboard/plan") {
        calls.push(path);
        const payload = route.request().postDataJSON(), s = payload.board.scene;
        assert.equal(payload.input, "在小兔右边加一辆汽车");
        const accepted = validateDrawingPlan({ baseRevision: s.revision, operations: [
          { op: "add", kind: "car", count: 1 },
          { op: "place", id: `object-${s.nextId}`, relativeTo: s.objects[0].id, side: "right" }
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
    assert.equal(await page.locator("#childWhiteboardPanel").isVisible(), false);
    await send("画一只小兔");
    await page.evaluate(() => { window.rabbitNode = document.querySelector('[data-subject="rabbit"]'); });
    await send("在小兔右边加一辆汽车");
    await page.waitForSelector('[data-subject="car"]');
    const pair = (await saved()).board.scene;
    assert.equal(pair.objects.find(o => o.kind === "car").x, 514);
    await send("汽车变蓝，兔子不要变");
    assert.ok(await page.evaluate(() => window.rabbitNode === document.querySelector('[data-subject="rabbit"]')));
    const car = page.locator('[data-subject="car"]');
    assert.equal(await car.locator('[data-part="asset-0"]').getAttribute("fill"), "#87bbc9");
    assert.equal(await car.locator('[data-part="asset-2"]').getAttribute("fill"), "#26C9FC");
    const pixels = await page.evaluate(async () => {
      const svg = document.querySelector(".illustration-scene > svg"), img = new Image();
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
      try {
        img.src = url; await img.decode();
        const c = document.createElement("canvas"); c.width = 640; c.height = 480;
        const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, 640, 480);
        const d = ctx.getImageData(0, 0, 640, 480).data;
        let blue = 0, white = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 200) continue;
          if (Math.abs(d[i] - 135) < 3 && Math.abs(d[i + 1] - 187) < 3 && Math.abs(d[i + 2] - 201) < 3) blue++;
          if (d[i] > 252 && d[i + 1] > 252 && d[i + 2] > 252) white++;
        }
        return { blue, white };
      } finally { URL.revokeObjectURL(url); }
    });
    assert.ok(pixels.blue > 1000 && pixels.white > 1000, JSON.stringify(pixels));
    await page.screenshot({ path: `screenshots/drawing-assets-${width}.png`, fullPage: true });
    assert.ok(await page.locator("#childWhiteboardPanel").isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.evaluate(() => {
      const bounds = document.querySelector(".illustration-scene > svg").getBoundingClientRect();
      return [...document.querySelectorAll('[data-object-id]')].every(g => {
        const b = g.getBoundingClientRect();
        return b.left >= bounds.left && b.right <= bounds.right && b.top >= bounds.top && b.bottom <= bounds.bottom;
      });
    }));
    await send("撤销");
    assert.deepEqual((await saved()).board.scene.objects, pair.objects);
    assert.equal(await car.locator('[data-part="asset-0"]').getAttribute("fill"), "#df837a");
    await send("把汽车车窗涂成紫色");
    assert.deepEqual((await saved()).board.scene.objects, pair.objects);
    await send("画一座房子");
    const mixed = (await saved()).board.scene.objects;
    assert.equal(mixed.length, 3);
    await page.reload();
    assert.deepEqual((await saved()).board.scene.objects, mixed);
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1")));
    assert.ok(db.growthMoments.some(m => m.boardSnapshot?.scene?.objects?.some(o => o.kind === "car")));
    assert.deepEqual(calls, ["/api/whiteboard/plan"]);
    assert.deepEqual(errors, []);
    console.log(`${width}px: visible assets/pixels, relative placement, scoped tint, stable rabbit, undo, mixed scene and local archive passed`);
    await context.close();
  }
} finally { await browser.close(); }
