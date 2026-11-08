import { waitForConversationPhase } from "./helpers/runtimeDiagnostics.mjs";
import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage(), errors = [], edits = [];
    let release, failure = false, delay = true, available = true;
    page.on("pageerror", error => errors.push(error.message));
    const state = createInitialState(); state.uiVersion = 4;
    state.profile = { ...state.profile, name: "模拟家庭", configured: true, consent: true, consentVersion: 2 };
    state.family = createInitialFamily(state.profile);
    state.session = { status: "active", id: "open-drawing-test", turnCount: 0 };
    await page.addInitScript(s => {
      if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(s));
      navigator.mediaDevices.getUserMedia = async () => { throw new Error("No family audio"); };
    }, state);
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let result = {};
      if (path === "/api/whiteboard/route") {
        const body = route.request().postDataJSON();
        assert.ok(!JSON.stringify(body).includes("data:image"));
        result = /你好|天气/.test(body.input) ? { mode: "chat" } : { mode: "image", operation: "edit", instruction: body.input, available };
      } else if (path === "/api/whiteboard/image") {
        edits.push(route.request().postDataJSON());
        if (delay) await new Promise(resolve => { release = resolve; });
        result = failure ? { ok: false, reason: "provider-error" } : { ok: true, image: await page.evaluate(() => {
          const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
          const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 512, 512);
          ctx.fillStyle = "#93b69b"; ctx.fillRect(0, 320, 512, 192);
          ctx.fillStyle = "#efc76e"; ctx.fillRect(150, 150, 180, 200);
          return canvas.toDataURL("image/png");
        }) };
      } else if (path === "/api/tutor/quick") {
        assert.ok(!route.request().postData().includes("data:image"));
        result = { reply: "你好，我们可以聊你想聊的。" };
      } else if (path === "/api/tutor") {
        const body = route.request().postDataJSON(); result = { ...body.state, board: { type: "blank" }, visualPlan: null };
      }
      try { await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) }); } catch {}
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4181/");
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await page.evaluate(() => { document.querySelector("#speakReplies").checked = false; });
    const send = text => page.evaluate(text => {
      document.querySelector("#childInput").value = text; document.querySelector("#askForm").requestSubmit();
    }, text);
    await send("画一个房子");
    await page.locator('[data-subject="house"]').waitFor();
    await send("屋顶改成蓝色");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.turnCount === 2);
    await send("给这个房子加上绿草地");
    await page.getByText("正在画，你可以继续说话", { exact: true }).waitFor();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.turnCount === 3);
    assert.equal(await page.locator('[data-subject="house"]').count(), 1, "Old drawing remains during generation");
    await send("你好");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.turnCount === 4);
    assert.equal(await page.locator('[data-subject="house"]').count(), 1, "Chat must not blank the in-progress original");
    assert.ok(release, "Image job has started without blocking conversation");
    release(); delay = false;
    await page.locator(".generated-image img").waitFor();
    assert.match(edits[0].image, /^data:image\/jpeg;base64,/);
    assert.equal(edits[0].operation, "edit");
    const first = await page.locator(".generated-image img").getAttribute("src");
    await send("把屋顶改成紫色");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).board.revision === 2);
    assert.equal(edits[1].image, first, "Edit uses actual original, not just text description");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).board.revision === 1);
    failure = true;
    await send("加一个穿雨靴的小朋友");
    await page.getByText("这次没画出来，原来的画没有改动", { exact: true }).waitFor();
    assert.equal(await page.locator(".generated-image img").getAttribute("src"), first);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载图画" }).click();
    assert.ok((await download).suggestedFilename().endsWith(".jpg"));
    await page.reload();
    await page.locator(".generated-image img").waitFor();
    assert.equal(await page.locator(".generated-image img").getAttribute("src"), first);
    assert.ok(await page.locator(".generated-image img").evaluate(img => img.complete && img.naturalWidth > 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `screenshots/open-drawing-${width}.png`, fullPage: true });
    const paper = await page.locator("#childWhiteboardPanel").boundingBox(), voice = await page.locator("#mainVoiceButton").boundingBox();
    assert.ok(voice.y >= paper.y + paper.height - 1, "Voice control does not cover picture");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.locator('[data-subject="house"]').waitFor();
    available = false;
    const requestsBefore = edits.length;
    await send("加上草地");
    await page.waitForFunction(() => document.querySelector("#messageList").textContent.includes("图片功能还没开启"));
    assert.equal(edits.length, requestsBefore, "Disabled provider cannot start paid generation");
    available = true; failure = false; delay = true; release = null;
    await send("加上草地");
    await page.getByText("正在画，你可以继续说话", { exact: true }).waitFor();
    await waitForConversationPhase(page, "complete");
    await page.locator("#endChildSession").click();
    release?.();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.status !== "active");
    assert.equal(await page.locator(".generated-image img").count(), 0, "Finished session cannot publish late drawing");
    assert.deepEqual(errors, []);
    console.log(`${width}px: precise -> image, background chat, actual-image editing, undo, failure, local restore and download passed`);
    await context.close();
  }
} finally { await browser.close(); }
