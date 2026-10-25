import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createInitialState } from "../src/data/studentModel.js";
import { normalizeLocalStudentDb } from "../src/data/localStudentDb.js";
import { createInitialFamily } from "../src/data/familyModel.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
await mkdir("screenshots/production-design", { recursive: true });
try {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => route.fulfill({ contentType: "application/json", body: "{}" }));
    const state = createInitialState(); state.uiVersion = 4;
    state.profile = { ...state.profile, name: "安安", configured: true, consent: true };
    state.studentModel.profile.nickname = "安安";
    state.family = createInitialFamily(state.profile);
    const topics = ["汽车", "颜色", "积木", "月亮", "小动物"];
    const moments = [0, 2, 6, 12, 35].map((ago, i) => {
      const date = new Date(); date.setDate(date.getDate() - ago);
      return { id: `design-${i}`, studentId: state.studentModel.studentId, childQuote: `我想了解${topics[i]}`, tutorResponse: "我们一起看看", topics: [topics[i]], domain: "science", observedAt: date.toISOString(), createdAt: date.toISOString(), evidence: { observation: `想了解${topics[i]}，留下了一个问题。` } };
    });
    const db = normalizeLocalStudentDb({ studentModels: { [state.studentModel.studentId]: state.studentModel }, growthMoments: moments });
    await page.addInitScript(({ state, db }) => {
      if (!localStorage.getItem("xiaoyuji-learning-state-v1")) {
        localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(state));
        localStorage.setItem("xiaoyuji-local-student-db-v1", JSON.stringify(db));
      }
      window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Isolated UI test", "NotAllowedError"); };
    }, { state, db });
    const nav = async action => {
      if (width <= 900) await page.locator("#mobileMenuButton").click();
      await page.locator(`[data-nav-action="${action}"]:visible`).click();
      await page.waitForTimeout(280);
    };
    const shot = async name => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator("img:visible").evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${name}: overflow`);
      await page.screenshot({ path: `screenshots/production-design/${width}-${name}.png`, fullPage: true });
    };
    await page.goto(process.env.TEST_URL || "http://localhost:4173/");
    await page.locator(".app-talk-launch").waitFor();
    assert.equal(await page.locator("#childWhiteboardPanel").isVisible(), false);
    await shot("home");
    await nav("growth");
    assert.match(await page.locator(".growth-simple-heading").first().innerText(), /3天 · 3个片段/);
    await shot("growth");
    await page.locator('[data-growth-range][value="month"]').check();
    assert.match(await page.locator(".growth-simple-heading").first().innerText(), /4天 · 4个片段/);
    await page.locator('[data-growth-range][value="all"]').check();
    assert.match(await page.locator(".growth-simple-heading").first().innerText(), /5天 · 5个片段/);
    await page.locator('[data-growth-range][value="week"]').check();
    await page.locator('[data-growth-step="previous"]').click();
    assert.match(await page.locator("#growthDiscoveryTitle").innerText(), /月亮/);
    assert.doesNotMatch(await page.locator("#growthDiscoveryTitle").innerText(), /汽车/);
    await page.locator('[data-growth-step="previous"]').click();
    assert.equal(await page.locator(".growth-record-chart").count(), 0);
    await shot("empty-period");
    await page.locator('[data-growth-step="next"]').click();
    await page.locator('[data-growth-step="next"]').click();
    await page.locator("[data-growth-bucket]").last().click();
    assert.equal(await page.locator(".growth-brief").count(), 1);
    await nav("parent");
    assert.equal(await page.locator("#profileForm").isVisible(), true);
    assert.equal(await page.locator("#parentSessionPanel").isVisible(), false);
    assert.equal(await page.locator("#familyRecap").getAttribute("open"), null);
    await page.locator("#studentName").fill("喜欢提问和画小汽车的安安");
    await page.locator("#saveProfile").click();
    await page.waitForFunction(() => document.querySelector("#profileSaveStatus").textContent.includes("已保存"));
    await page.locator("#familyMemberName").fill("妈妈");
    await page.locator("#familyMemberForm button").click();
    assert.equal(await page.locator(".family-member-row").count(), 2);
    await shot("settings");
    await page.reload();
    await nav("parent");
    assert.equal(await page.locator("#studentName").inputValue(), "喜欢提问和画小汽车的安安");
    assert.equal(await page.locator(".family-member-row").count(), 2);
    const toggle = await page.locator("#consent").boundingBox();
    assert.equal(toggle.width, 48); assert.equal(toggle.height, 28);
    await nav("growth");
    await shot("long-name");
    await nav("backup");
    const download = page.waitForEvent("download");
    await page.locator("#backupExportData").click();
    assert.ok((await download).suggestedFilename().endsWith(".json"));
    assert.equal(await page.locator(".conversation-moment").count(), 5);
    await shot("backup");
    await nav("talk");
    await page.locator('[data-session-action="quick-start"]').click();
    await page.locator("#childStage").waitFor();
    await page.evaluate(() => { document.querySelector("#speakReplies").checked = false; });
    const send = async input => {
      await page.evaluate(input => { document.querySelector("#childInput").value = input; document.querySelector("#askForm").requestSubmit(); }, input);
    };
    await send("画一个房子");
    await page.locator('[data-subject="house"]').waitFor();
    await shot("whiteboard");
    const paper = await page.locator("#childWhiteboardPanel").boundingBox(), voice = await page.locator("#mainVoiceButton").boundingBox();
    assert.ok(voice.y >= paper.y + paper.height, "voice should not overlap whiteboard");
    await send("屋顶改成蓝色");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.turnCount >= 2);
    assert.equal(await page.locator("#childWhiteboardPanel").isVisible(), true);
    await page.locator("#endChildSession").click();
    assert.equal(await page.locator(".workspace").getAttribute("data-active-view"), "parent");
    if (width <= 900) {
      await page.locator("#mobileMenuButton").click();
      await page.waitForTimeout(280);
      for (let i = 0; i < 9; i++) {
        await page.keyboard.press("Tab");
        assert.ok(await page.evaluate(() => document.querySelector("#mobileDrawerPanel").contains(document.activeElement)));
      }
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#mobileMenuButton").evaluate(el => el === document.activeElement), true);
    }
    await nav("parent");
    await page.locator(".profile-extras summary").click();
    await page.locator("#parentPin").fill("1234");
    await page.locator("#saveProfile").click();
    await page.waitForFunction(() => document.querySelector("#profileSaveStatus").textContent.includes("家长码已保存"));
    await nav("talk");
    await nav("growth");
    assert.equal(await page.locator("#parentLock").isVisible(), true);
    await page.locator("#parentUnlockPin").fill("0000");
    await page.locator('#parentUnlockForm button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector("#parentLockStatus").textContent.includes("不对"));
    await page.locator("#parentUnlockPin").fill("1234");
    await page.locator('#parentUnlockForm button[type="submit"]').click();
    await page.locator("#parentLock").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".workspace").getAttribute("data-active-view"), "memory");
    assert.deepEqual(errors, []);
    console.log(`PASS production ${width}px: home, date scope, persistence, family, archive, drawing, keyboard`);
    await context.close();
  }
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await fresh.newPage();
  await page.route("**/api/**", route => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.goto(process.env.TEST_URL || "http://localhost:4173/");
  await page.locator('[data-session-action="show-parent"]').click();
  assert.equal(await page.locator("#parentSessionPanel").isVisible(), true);
  assert.equal(await page.locator("#profileForm").isVisible(), false);
  await page.locator("#startChildSession").click();
  assert.match(await page.locator("#sessionFormStatus").innerText(), /昵称/);
  await page.locator("#startChildName").fill("新朋友");
  await page.locator("#startChildSession").click();
  assert.match(await page.locator("#sessionFormStatus").innerText(), /家长同意/);
  await page.screenshot({ path: "screenshots/production-design/390-first-setup.png", fullPage: true });
  await fresh.close();
  console.log("PASS first-use setup and guardian consent remain required");
} finally { await browser.close(); }
