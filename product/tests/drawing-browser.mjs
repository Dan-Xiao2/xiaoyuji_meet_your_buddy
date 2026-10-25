import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
import { createTutorTurn } from "../src/services/tutorEngine.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage(), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = createInitialState();
    state.uiVersion = 4;
    state.profile = { ...state.profile, name: "测试孩子", configured: true, consent: true };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "drawing-test", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(state => localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(state)), state);
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let response = {};
      if (path.startsWith("/api/tutor")) {
        const payload = route.request().postDataJSON(); requests.push(payload.input);
        response = path.endsWith("/quick") ? { reply: "太阳里面的变化会放出很多能量，所以会发光。" } : createTutorTurn(payload.input, payload.state);
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4174/");
    await page.evaluate(() => document.querySelector("#speakReplies").checked = false);
    const send = async text => {
      await page.evaluate(text => {
        document.querySelector("#childInput").value = text;
        document.querySelector("#askForm").requestSubmit();
      }, text);
    };
    await send("画一个房子");
    await page.waitForSelector('[data-subject="house"]');
    assert.equal(await page.locator(".illustration-scene svg path").count() > 5, true);
    assert.equal(requests.length, 0);
    await send("再加一个太阳");
    await page.waitForSelector('[data-subject="sun"]');
    assert.equal(await page.locator('[data-subject="house"]').count(), 1);
    await send("把屋顶涂成蓝色");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).board.scene.roofColor === "#87bbc9");
    await page.waitForTimeout(500);
    assert.equal(await page.locator('path[fill="#87bbc9"]').count() > 0, true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.evaluate(() => document.querySelector("#mainVoiceButton").getBoundingClientRect().bottom <= innerHeight), "Continue speaking stays in the viewport");
    await page.screenshot({ path: `screenshots/drawing-house-${width}.png`, fullPage: true });
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1")));
    assert.equal(db.growthMoments.length, 3);
    assert.equal(db.growthMoments[0].domain, "art");
    assert.deepEqual(db.growthMoments[0].boardSnapshot.scene.subjects, ["house", "sun"]);
    await send("太阳为什么会发光");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).llmStatus?.stage === "complete");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")));
    assert.match(saved.messages.at(-1).text, /太阳/);
    assert.doesNotMatch(saved.messages.at(-1).text, /积木/);
    assert.equal(saved.lastAssessment, null);
    assert.equal(await page.locator(".illustration-scene").count(), 0);
    await send("画一只恐龙");
    assert.equal(await page.locator(".block-scene").count(), 0);
    assert.equal(await page.locator(".illustration-scene").count(), 0);
    const text = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).messages.at(-1).text);
    assert.match(text, /暂时/);
    assert.deepEqual(errors, []);
    console.log(`${width}px: drawing request, scene addition, recolor, topic change, unsupported object and saved art evidence passed`);
    await context.close();
  }
} finally { await browser.close(); }
