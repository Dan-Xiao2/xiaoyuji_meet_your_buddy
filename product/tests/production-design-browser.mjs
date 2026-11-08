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
    state.profile = { ...state.profile, name: "安安", configured: true, consent: true, consentVersion: 2 };
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
      // From the child's screen, the parent button opens the parent area (keyboard activation enters
      // directly); with a parent code set, the code is asked first.
      await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
      if (action !== "talk" && await page.locator("#parentEntry").isVisible()) {
        await page.locator("#parentEntry").press("Enter");
        if (await page.locator("#parentLock").isVisible()) return;
      }
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
    // Each setting opens its own page; saving returns to the list with the new value.
    await page.locator('[data-subpage="name"]').click();
    await page.locator("#profileSubpage").waitFor({ state: "visible" });
    assert.equal(await page.locator("#interest").isVisible(), false, "one setting per page");
    await page.locator("#studentName").fill("喜欢提问和画小汽车的安安");
    await page.locator("#saveProfile").click();
    await page.waitForFunction(() => document.querySelector("#profileSaveStatus").textContent.includes("已保存"));
    await page.locator("#profileSubpage").waitFor({ state: "hidden" });
    assert.equal(await page.locator('[data-profile-value="name"]').innerText(), "喜欢提问和画小汽车的安安");
    await page.locator("#familyAddOpen").click();
    await page.locator("#familyMemberName").fill("妈妈");
    await page.locator("#familyMemberForm button").click();
    await page.locator("#familySubpage").waitFor({ state: "hidden" });
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
    // The parent area has its own navigation; the child's screen has none, only a hold-to-enter button.
    assert.equal(await page.locator(width <= 900 ? "#parentTabs" : "#desktopNavigation").isVisible(), true);
    await page.locator("#backToXiaoyu").click();
    assert.equal(await page.locator(".topbar").isVisible(), false);
    assert.equal(await page.locator("#parentEntry").isVisible(), true);
    await page.locator("#parentEntry").click(); // a short tap only explains
    assert.equal(await page.locator("#parentEntryHint").isVisible(), true);
    assert.equal(await page.locator(".workspace").getAttribute("data-active-view"), "learn");
    const entry = await page.locator("#parentEntry").boundingBox();
    await page.mouse.move(entry.x + entry.width / 2, entry.y + entry.height / 2);
    await page.mouse.down(); await page.waitForTimeout(1150); await page.mouse.up();
    assert.equal(await page.locator(".workspace").getAttribute("data-active-view"), "memory");
    await nav("parent");
    await page.locator('[data-subpage="pin"]').click();
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
  // First use opens by itself: Xiaoyu's hello, consent, nickname, age, microphone check, hand over.
  // Nothing about the child is entered before consent; the chat starts after the hand over.
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await fresh.newPage();
  await page.route("**/api/**", route => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.addInitScript(() => {
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Isolated UI test", "NotAllowedError"); };
  });
  await page.goto(process.env.TEST_URL || "http://localhost:4173/");
  await page.locator("#setupFlow").waitFor({ state: "visible" });
  assert.match(await page.locator("#setupBubble").innerText(), /我是小宇/);
  await page.locator("#setupAgree").waitFor({ state: "visible" });
  assert.equal(await page.locator("#setupTitle").innerText(), "个人信息保护提示");
  assert.match(await page.locator("#consentFacts").innerText(), /云端/);
  assert.equal(await page.locator("#setupName").isVisible(), false);
  await page.screenshot({ path: "screenshots/production-design/390-setup-consent.png" });
  await page.getByRole("button", { name: "不同意" }).click();
  assert.match(await page.locator("#setupConsentStatus").innerText(), /无法使用/);
  await page.getByRole("button", { name: "同意并继续" }).click();
  await page.locator("#setupName").waitFor({ state: "visible" });
  assert.equal(await page.locator("#setupNameNext").isDisabled(), true);
  await page.locator("#setupName").fill("新朋友");
  assert.match(await page.locator("#setupBubble").innerText(), /嗨，新朋友/);
  await page.screenshot({ path: "screenshots/production-design/390-setup-name.png" });
  await page.locator("#setupNameNext").click();
  await page.locator('[data-setup-age="5-6"]').click();
  await page.locator("#setupMicAllow").waitFor({ state: "visible" });
  const setUp = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).profile);
  assert.deepEqual([setUp.name, setUp.ageBand, setUp.consent, setUp.consentVersion, setUp.configured], ["新朋友", "5-6", true, 2, true]);
  // A refused microphone shows how to allow it, and can be skipped.
  await page.locator("#setupMicAllow").click();
  await page.locator("#setupMicDenied").waitFor({ state: "visible" });
  await page.screenshot({ path: "screenshots/production-design/390-setup-mic-denied.png" });
  await page.getByRole("button", { name: /跳过，之后/ }).click();
  await page.locator("#setupHandover").waitFor({ state: "visible" });
  assert.match(await page.locator("#setupBubble").innerText(), /交给新朋友/);
  await page.screenshot({ path: "screenshots/production-design/390-setup-handover.png" });
  await page.locator("#setupHandover").click();
  await page.locator("#childStage").waitFor({ state: "visible" });
  assert.equal(await page.locator("#setupFlow").isVisible(), false);
  await fresh.close();
  console.log("PASS first use: opening, consent, nickname, age, microphone check and hand over");

  // A family that agreed to the older wording sees only the policy update (no name or age), and
  // agreeing keeps their saving choice.
  const old = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const oldPage = await old.newPage();
  await oldPage.route("**/api/**", route => route.fulfill({ contentType: "application/json", body: "{}" }));
  const oldState = createInitialState(); oldState.uiVersion = 4;
  oldState.profile = { ...oldState.profile, name: "安安", ageBand: "5-6", configured: true, consent: false };
  oldState.family = createInitialFamily(oldState.profile);
  // A chat left open: it must not be resumed past the new consent.
  oldState.session = { status: "active", id: "left-open", studentId: oldState.studentModel.studentId, startedAt: new Date().toISOString(), turnCount: 3 };
  await oldPage.addInitScript(saved => {
    if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(saved));
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
  }, oldState);
  await oldPage.goto(process.env.TEST_URL || "http://localhost:4173/");
  assert.equal(await oldPage.locator("#childStage").isVisible(), false, "the open chat is not resumed");
  assert.match(await oldPage.locator(".app-home-instruction").innerText(), /隐私政策已更新/);
  await oldPage.getByRole("button", { name: "家长确认" }).click();
  await oldPage.locator("#setupFlow").waitFor({ state: "visible" });
  assert.equal(await oldPage.locator("#setupTitle").innerText(), "隐私政策更新");
  assert.equal(await oldPage.locator("#consentFacts").isVisible(), true);
  assert.equal(await oldPage.locator("#setupDots").isVisible(), false);
  await oldPage.screenshot({ path: "screenshots/production-design/390-reconsent.png" });
  await oldPage.getByRole("button", { name: "同意并继续" }).click();
  await oldPage.locator("#setupFlow").waitFor({ state: "hidden" });
  const agreed = await oldPage.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).profile);
  assert.deepEqual([agreed.consentVersion, agreed.consent, agreed.name, agreed.ageBand], [2, false, "安安", "5-6"]);
  await oldPage.reload();
  assert.match(await oldPage.locator(".app-home-instruction").innerText(), /开始聊天/, "asked once, not every time");
  await oldPage.locator('[data-session-action="quick-start"]').click();
  await oldPage.locator("#childStage").waitFor({ state: "visible" });
  await old.close();
  console.log("PASS older consent: asked once more, saving choice kept");

  // Saving switched off later: chatting still starts from the home screen, and no moment is saved.
  const off = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const offPage = await off.newPage();
  await offPage.route("**/api/**", route => route.fulfill({ contentType: "application/json", body: "{}" }));
  const offState = createInitialState(); offState.uiVersion = 4;
  offState.profile = { ...offState.profile, name: "安安", configured: true, consent: false, consentVersion: 2 };
  offState.family = createInitialFamily(offState.profile);
  await offPage.addInitScript(saved => {
    if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(saved));
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
  }, offState);
  await offPage.goto(process.env.TEST_URL || "http://localhost:4173/");
  await offPage.locator('[data-session-action="quick-start"]').click();
  await offPage.locator("#childStage").waitFor({ state: "visible" });
  const db = await offPage.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1") || "{}"));
  assert.ok(db.studentModels && Object.keys(db.studentModels).length === 1, "the profile itself was saved");
  assert.equal((db.sessions || []).length, 0, "no session record while saving is off");
  assert.equal((db.growthMoments || []).length, 0);
  await off.close();
  console.log("PASS saving switched off: chatting still starts, nothing new is saved");
} finally { await browser.close(); }
