import { waitForConversationPhase } from "./helpers/runtimeDiagnostics.mjs";
import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage(), errors = [], requests = [], routes = [], unexpected = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = createInitialState();
    state.uiVersion = 4;
    state.profile = { ...state.profile, name: "测试孩子", configured: true, consent: true };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "drawing-test", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(state => localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(state)), state);
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let response;
      if (path === "/api/voice-status") response = {};
      else if (path === "/api/whiteboard/route") {
        const payload = route.request().postDataJSON(); routes.push(payload.input);
        response = payload.input === "太阳为什么会发光" ? { mode: "chat" }
          : payload.input === "画一只恐龙" ? { mode: "image", operation: "create", instruction: payload.input, available: false }
          : payload.input === "画一只鲸鱼" ? {}
          : null;
      } else if (path === "/api/tutor/quick" || path === "/api/tutor/quick/stream") {
        const payload = route.request().postDataJSON(); requests.push(payload.input);
        response = { reply: "太阳里面的变化会放出很多能量，所以会发光。", llmStatus: { used: false } };
        // The page asks for the reply sentence by sentence; answer in that format.
        if (path.endsWith("/stream")) {
          await route.fulfill({ contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "sentence", text: response.reply })}\n${JSON.stringify({ type: "done", ...response })}\n` });
          return;
        }
      }
      if (!response) {
        unexpected.push(path);
        await route.fulfill({ status: 500, body: "Unexpected test request" });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4174/");
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
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
    const retainedBoard = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).board);
    await send("太阳为什么会发光");
    await waitForConversationPhase(page, "complete");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")));
    assert.match(saved.messages.at(-1).text, /太阳/);
    assert.doesNotMatch(saved.messages.at(-1).text, /积木/);
    assert.equal(saved.lastAssessment, null);
    assert.deepEqual(requests, ["太阳为什么会发光"], "The topic question actually reaches Tutor");
    assert.deepEqual(saved.board, retainedBoard, "Chat preserves the accepted drawing");
    assert.equal(await page.locator(".illustration-scene").count(), 1);
    const topicMoment = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1")).growthMoments[0]);
    assert.equal(topicMoment.domain, "language", "An ordinary question does not inherit art from the screen");
    assert.equal(topicMoment.lessonTitle, "");
    assert.equal(topicMoment.boardSnapshot, null);
    assert.ok(!topicMoment.topics.includes(saved.board.title));
    await send("画一只恐龙");
    await waitForConversationPhase(page, "complete");
    assert.equal(await page.locator(".block-scene").count(), 0);
    assert.equal(await page.locator(".illustration-scene").count(), 1, "Unavailable generation keeps the previous picture");
    const text = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).messages.at(-1).text);
    assert.match(text, /图片功能还没开启/);
    await send("画一只鲸鱼");
    await waitForConversationPhase(page, "complete");
    const afterInvalidRoute = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")));
    assert.match(afterInvalidRoute.messages.at(-1).text, /没处理成功/);
    assert.deepEqual(afterInvalidRoute.board, retainedBoard, "Malformed route cannot change the picture");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1")).growthMoments.length), 4,
      "Unavailable or malformed drawing requests do not invent growth evidence");
    assert.deepEqual(routes, ["太阳为什么会发光", "画一只恐龙", "画一只鲸鱼"]);
    assert.deepEqual(unexpected, [], "No unmocked plan, image or enrichment request");
    assert.deepEqual(errors, []);
    console.log(`${width}px: drawing, recolor, retained picture, turn-owned evidence and unavailable image generation passed`);
    await context.close();
  }
} finally { await browser.close(); }
