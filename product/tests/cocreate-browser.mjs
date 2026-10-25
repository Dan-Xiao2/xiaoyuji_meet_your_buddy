import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const viewport of [{ width: 390, height: 850 }, { width: 768, height: 1024 }, { width: 1440, height: 850 }, { width: 390, height: 667 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: viewport.width === 768 ? "reduce" : "no-preference" });
    const page = await context.newPage(), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = createInitialState();
    state.uiVersion = 4;
    state.profile = { ...state.profile, name: "共创测试", configured: true, consent: true };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "cocreate-test", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(state => {
      if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(state));
    }, state);
    await page.route("**/api/**", async route => {
      if (new URL(route.request().url()).pathname.startsWith("/api/tutor")) requests.push(route.request().url());
      await route.fulfill({ contentType: "application/json", body: "{}" });
    });
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")));
    const send = async text => {
      const count = (await saved()).session.turnCount;
      await page.evaluate(text => {
        document.querySelector("#childInput").value = text;
        document.querySelector("#askForm").requestSubmit();
      }, text);
      await page.waitForFunction(count => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.turnCount > count, count);
    };
    await page.goto(process.env.TEST_URL || "http://localhost:4174/");
    await page.evaluate(() => document.querySelector("#speakReplies").checked = false);
    assert.equal(await page.locator(".illustration-scene").count(), 0);
    await send("画两座房子");
    assert.equal(await page.locator('[data-subject="house"]').count(), 2);
    await page.evaluate(() => { window.originalHouse = document.querySelector('[data-subject="house"]'); });
    const original = (await saved()).board.scene;
    await send("把屋顶涂成蓝色");
    assert.equal((await saved()).board.scene.revision, original.revision);
    await send("右边的");
    assert.equal((await saved()).board.scene.objects[1].roofColor, "#87bbc9");
    assert.ok(await page.evaluate(() => window.originalHouse === document.querySelector('[data-subject="house"]')));
    await send("把左边房子变小一点");
    assert.equal((await saved()).board.scene.objects[0].scale, 0.8);
    await send("加一条小路");
    await page.waitForSelector('[data-subject="path"]');
    const roadBefore = await page.locator('[data-subject="path"] path').getAttribute("d");
    await send("把最大的房子放到左边");
    const connected = (await saved()).board.scene;
    assert.ok(connected.objects[1].x < connected.objects[0].x);
    await page.waitForFunction(before => document.querySelector('[data-subject="path"] path')?.getAttribute("d") !== before, roadBefore);
    assert.notEqual(await page.locator('[data-subject="path"] path').getAttribute("d"), roadBefore);
    await send("再加一个太阳");
    await send("再加一朵云");
    const complete = (await saved()).board.scene;
    await page.waitForTimeout(450);
    assert.equal(await page.locator('[data-object-id]').count(), 5);
    // Inspect actual raster pixels as well as DOM existence: a valid graph is not enough.
    const pixels = await page.evaluate(async () => {
      const svg = document.querySelector(".illustration-scene > svg");
      const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob), img = new Image();
      try {
        img.src = url; await img.decode();
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, 640, 480);
        const data = ctx.getImageData(0, 0, 640, 480).data;
        let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 30) count++;
        return count;
      } finally { URL.revokeObjectURL(url); }
    });
    assert.ok(pixels > 20000, `Expected visible artwork, got ${pixels} pixels`);
    assert.ok(await page.evaluate(() => {
      const svg = document.querySelector(".illustration-scene > svg").getBoundingClientRect();
      return [...document.querySelectorAll('[data-object-id]')].every(g => {
        const r = g.getBoundingClientRect();
        return r.left >= svg.left - 2 && r.right <= svg.right + 2 && r.top >= svg.top - 2 && r.bottom <= svg.bottom + 2;
      });
    }), "Every object remains inside the drawing surface");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.evaluate(() => document.querySelector("#mainVoiceButton").getBoundingClientRect().bottom <= innerHeight));
    await page.screenshot({ path: `screenshots/cocreate-${viewport.width}-${viewport.height}.png`, fullPage: true });
    if (viewport.width === 768) assert.equal(await page.evaluate(() => document.querySelector(".illustration-scene").getAnimations({ subtree: true }).length), 0);
    await send("画一只恐龙");
    assert.deepEqual((await saved()).board.scene.objects, complete.objects);
    assert.equal(await page.locator('[data-object-id]').count(), 5);
    await send("删除左边的房子");
    assert.equal(await page.locator('[data-subject="house"]').count(), 1);
    assert.equal(await page.locator('[data-subject="path"]').count(), 0);
    await send("撤销");
    assert.deepEqual((await saved()).board.scene.objects, complete.objects);
    await send("清空画纸");
    assert.equal(await page.locator('[data-object-id]').count(), 0);
    await send("撤销");
    assert.deepEqual((await saved()).board.scene.objects, complete.objects);
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1")));
    const snapshots = db.growthMoments.map(m => m.boardSnapshot?.scene).filter(Boolean);
    assert.ok(snapshots.some(s => s.version === 2 && s.objects.some(o => o.kind === "path")));
    const beforeReload = (await saved()).board.scene;
    await page.reload();
    assert.deepEqual((await saved()).board.scene.objects, beforeReload.objects);
    assert.equal(requests.length, 0, "This milestone must work locally without model calls");
    assert.deepEqual(errors, []);
    console.log(`${viewport.width}x${viewport.height}: stable nodes, clarification, road relations, edits, undo, raster, bounds, restore passed`);
    await context.close();
  }
} finally { await browser.close(); }
