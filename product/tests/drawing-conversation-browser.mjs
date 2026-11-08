import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const state = createInitialState(); state.uiVersion = 4;
    state.profile = { ...state.profile, name: "模拟家庭", configured: true, consent: true, consentVersion: 2 };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "drawing-dialogue", turnCount: 0 };
    await page.addInitScript(s => {
      if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(s));
      navigator.mediaDevices.getUserMedia = async () => { throw new Error("No microphone in synthetic test"); };
    }, state);
    const inputs = [], imageRequests = [], errors = [];
    let available = false, routeFailure = false, imageFailure = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let result = {};
      if (path === "/api/whiteboard/route") {
        const body = route.request().postDataJSON(); inputs.push(body.input);
        if (routeFailure) { await route.fulfill({ status: 503, body: "Unavailable" }); return; }
        result = /为什么/.test(body.input) ? { mode: "chat" } : {
          mode: "image", operation: /草地|改成/.test(body.input) ? "edit" : "create",
          instruction: body.input === "想把它画在沙漠里面。" ? "我想画一个仙人掌在沙漠里面。" : body.input, available
        };
        if (body.input === "想把它画在沙漠里面。") assert.equal(body.pendingRequest, "我想画一个仙人掌。");
      } else if (path === "/api/whiteboard/image") {
        imageRequests.push(route.request().postDataJSON());
        result = imageFailure ? { ok: false, reason: "provider-error" } : { ok: true, image: await page.evaluate(() => {
          const c = document.createElement("canvas"); c.width = 400; c.height = 400;
          const ctx = c.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 400, 400);
          ctx.fillStyle = "#397960"; ctx.fillRect(140, 80, 120, 240);
          return c.toDataURL("image/png");
        }) };
      } else if (path === "/api/tutor/quick") result = { reply: "我们聊聊这个问题。" };
      else if (path === "/api/tutor") {
        const body = route.request().postDataJSON();
        result = { ...body.state, board: { type: "blank" }, visualPlan: null, growthEvidence: { shouldSave: false } };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4173/");
    await page.evaluate(() => { document.querySelector("#speakReplies").checked = false; });
    let count = 0;
    async function send(text) {
      await page.evaluate(text => { document.querySelector("#childInput").value = text; document.querySelector("#askForm").requestSubmit(); }, text);
      await page.waitForFunction(count => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.turnCount === count, ++count);
      return page.locator(".message-tutor").last().innerText();
    }
    const request = "我想画一个仙人掌在沙漠里面。";
    assert.match(await send("我想画一个仙人掌。"), /图片功能还没开启/);
    assert.match(await send("想把它画在沙漠里面。"), /图片功能还没开启/);
    assert.match(await send("不用了，你直接画吧。"), /图片功能还没开启/);
    assert.equal(inputs.at(-1), request, "Retry uses the complete request, not the vague followup");
    assert.equal(imageRequests.length, 0);
    assert.equal(await page.locator("#drawingStatus").isVisible(), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1") || "{}").growthMoments?.length || 0), 0);
    await page.reload();
    await page.evaluate(() => { document.querySelector("#speakReplies").checked = false; });
    assert.match(await send("直接画吧"), /图片功能还没开启/);
    assert.equal(inputs.at(-1), request, "Unfinished request survives a page refresh");
    available = true;
    assert.match(await send("再试一次"), /我来试着画/);
    await page.locator(".generated-image img").waitFor();
    assert.equal(imageRequests[0].instruction, request);
    assert.equal(imageRequests[0].operation, "create");
    assert.equal(imageRequests[0].image, undefined);
    const original = await page.locator(".generated-image img").getAttribute("src");
    const before = inputs.length;
    assert.match(await send("哈喽，小雨，可以听到我说话吗？"), /我收到你这句话/);
    assert.equal(inputs.length, before, "Hearing check requires no drawing model call");
    assert.equal(await page.locator(".generated-image img").getAttribute("src"), original);
    imageFailure = true;
    await send("把仙人掌改成蓝色");
    await page.getByText("这次没画出来，原来的画没有改动", { exact: true }).waitFor();
    assert.equal(imageRequests.at(-1).image, original);
    routeFailure = true;
    assert.match(await send("再试一次"), /请求没处理成功/);
    assert.equal(inputs.at(-1), "把仙人掌改成蓝色");
    assert.equal(await page.locator(".generated-image img").getAttribute("src"), original);
    routeFailure = false;
    await send("不用画了");
    const cancelledAt = inputs.length;
    assert.match(await send("直接画吧"), /你想画什么/);
    assert.equal(inputs.length, cancelledAt, "Cancellation does not resurrect an old request");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(`${width}px: explicit request, disabled feedback, retry, refresh, mocked create/edit, hearing check, failure and cancellation passed`);
    await context.close();
  }
} finally { await browser.close(); }
