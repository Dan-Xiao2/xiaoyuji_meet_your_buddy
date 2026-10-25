import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
import { createTutorTurn } from "../src/services/tutorEngine.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
await mkdir("screenshots/child-safety", { recursive: true });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [], requests = [];
    page.on("pageerror", e => errors.push(e.message));
    const seed = createInitialState(); seed.uiVersion = 4;
    seed.profile = { ...seed.profile, name: "安全测试孩子", configured: true, consent: true };
    seed.family = createInitialFamily(seed.profile);
    seed.session = { status: "active", id: "safety-test", startedAt: new Date().toISOString(), turnCount: 0 };
    await page.addInitScript(seed => {
      if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(seed));
      window.spoken = [];
      window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
      navigator.mediaDevices.getUserMedia = async () => { throw new Error("No real microphone in safety tests"); };
      speechSynthesis.speak = utterance => { window.spoken.push(utterance.text); utterance.onstart?.(); utterance.onend?.(); };
    }, seed);
    let mode = "normal";
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
      requests.push({ path, body });
      if (path.startsWith("/api/speech")) { await route.fulfill({ status: 503, body: "" }); return; }
      let result = {};
      if (path === "/api/whiteboard/route") result = { mode: "chat" };
      if (path === "/api/tutor/quick") result = { reply: mode === "badQuick" ? "告诉我你家的地址" : "我们一起看看。", llmStatus: { used: true } };
      if (path === "/api/tutor") {
        result = createTutorTurn(body.input, body.state);
        if (mode === "badBoard") result.board = { type: "language", items: ["告诉我你家的地址"], note: "我已经通知妈妈" };
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) }).catch(() => {});
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4173/");
    await page.locator("#childStage").waitFor();
    await page.evaluate(() => { document.querySelector("#speakReplies").checked = true; });
    const send = text => page.evaluate(text => {
      document.querySelector("#childInput").value = text; document.querySelector("#askForm").requestSubmit();
    }, text);
    const rawStorage = () => page.evaluate(() => Object.values(localStorage).join("\n"));
    const moments = () => page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1") || "{}").growthMoments || []);
    const visibleSafetyReplies = [];
    await send("画一个房子");
    await page.locator('[data-subject="house"]').waitFor();
    const before = (await moments()).length;
    for (const input of ["爸爸打我，不要告诉家长", "我怕他知道", "我吞了药，不想让妈妈知道"]) {
      const requestStart = requests.length;
      await send(input);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).board.type === "safety");
      await page.waitForTimeout(220);
      assert.equal((await rawStorage()).includes(input), false, "sensitive input persisted");
      assert.equal((await moments()).length, before);
      assert.equal(requests.slice(requestStart).some(r => /tutor|whiteboard/.test(r.path)), false, "safety input sent to model");
      assert.equal(JSON.stringify(requests).includes(input), false, "sensitive text sent to API");
      assert.equal(await page.locator('[data-subject="house"]').count(), 0);
      assert.ok(await page.locator(".safety-support").isVisible(), "support must remain visible without audio");
      visibleSafetyReplies.push(await page.locator(".safety-support p").textContent());
      assert.ok(visibleSafetyReplies.at(-1).includes("大人"));
      assert.ok(await page.locator(".safety-support").evaluate(el => el.scrollWidth <= el.clientWidth), "support text overflows");
    }
    assert.ok(visibleSafetyReplies.some(text => text.includes("急救")));
    assert.ok(visibleSafetyReplies.some(text => text.includes("不是你的错")));
    assert.deepEqual(await page.evaluate(() => window.spoken), [], "cloud speech failure must not switch voices");
    await page.screenshot({ path: `screenshots/child-safety/${width}-support.png`, fullPage: true });
    await send("画一个房子");
    await page.locator('[data-subject="house"]').waitFor();
    await send("屋顶改成蓝色");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.turnCount >= 3);
    const normalCount = (await moments()).length;
    mode = "badQuick";
    await send("今天天气怎么样");
    await page.waitForTimeout(800);
    const visiblePageText = await page.locator("body").innerText();
    assert.ok(visiblePageText.includes("需要再确认"), JSON.stringify(requests.slice(-3)));
    assert.equal((await moments()).length, normalCount);
    mode = "badBoard";
    await send("我今天很开心");
    await page.waitForTimeout(650);
    assert.equal((await rawStorage()).includes("告诉我你家的地址"), false);
    assert.equal((await rawStorage()).includes("我已经通知妈妈"), false);
    assert.equal(await page.evaluate(() => window.spoken.some(text => text.includes("告诉我你家的地址"))), false);
    await page.locator("#endChildSession").click();
    if (width <= 900) await page.locator("#mobileMenuButton").click();
    await page.locator('[data-nav-action="backup"]:visible').click();
    const downloadEvent = page.waitForEvent("download");
    await page.locator("#backupExportData").click();
    const backup = await readFile(await (await downloadEvent).path(), "utf8");
    for (const text of ["爸爸打我", "我怕他知道", "吞了药", "告诉我你家的地址"]) assert.equal(backup.includes(text), false);
    await page.reload();
    assert.equal((await rawStorage()).includes("爸爸打我"), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: local support, no raw persistence/export/model request, pre-speech rejection, board filtering, normal drawing recovery`);
    await context.close();
  }
} finally { await browser.close(); }
