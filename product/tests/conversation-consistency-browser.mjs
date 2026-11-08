import { waitForConversationPhase } from "./helpers/runtimeDiagnostics.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily, addFamilyMember } from "../src/data/familyModel.js";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
await mkdir("screenshots/conversation-consistency", { recursive: true });
try {
  for (const width of [390, 1440]) {
    for (const boardMode of ["blank", "existing-drawing"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const state = createInitialState(); state.uiVersion = 4;
    state.profile = { ...state.profile, name: "模拟家庭", configured: true, consent: true, consentVersion: 2 };
    state.family = addFamilyMember(createInitialFamily(state.profile), { name: "模拟家长", role: "mother" });
    const caregiver = state.family.members.find(member => member.role !== "child");
    assert.ok(caregiver);
    state.session = { status: "active", id: "consistency-test", turnCount: 0 };
    if (boardMode === "existing-drawing") state.board = resolveIllustrationPlan("画一个房子", state).board;
    await page.addInitScript(s => {
      localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(s));
      navigator.mediaDevices.getUserMedia = async () => { throw new Error("No microphone in synthetic tests"); };
      window.syntheticSystemSpeech = 0;
      window.speechSynthesis.speak = () => { window.syntheticSystemSpeech++; };
    }, state);
    const calls = [], errors = [];
    let speechCalls = 0;
    const spokenTexts = [];
    let releaseQuick, releaseEnrichment;
    const quickGate = new Promise(resolve => { releaseQuick = resolve; });
    const enrichmentGate = new Promise(resolve => { releaseEnrichment = resolve; });
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/speech")) {
        speechCalls++;
        spokenTexts.push(route.request().postDataJSON().text);
        await route.fulfill({ status: 503, body: "Unavailable" }); return;
      }
      let result = {};
      if (path === "/api/whiteboard/route") result = { mode: "chat" };
      else if (path === "/api/tutor/quick") {
        calls.push("quick");
        await quickGate;
        result = { reply: "你不想选颜色，那就不选。", llmStatus: { used: true } };
      } else if (path === "/api/tutor") {
        calls.push("enrichment");
        await enrichmentGate;
        const body = route.request().postDataJSON();
        assert.equal(body.spokenReply, "你不想选颜色，那就不选。");
        result = { ...body.state, activeLesson: null, board: { type: "blank" }, messages: [...body.state.messages, { role: "tutor", text: body.spokenReply }], growthEvidence: { shouldSave: false } };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.goto(process.env.TEST_URL || "http://localhost:4173/");
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await page.evaluate(() => { document.querySelector("#childInput").value = "我不想选颜色"; document.querySelector("#askForm").requestSubmit(); });
    await waitForConversationPhase(page, "quick");
    await page.evaluate(() => {
      document.querySelector("#profileForm").elements.studentName.value = "更新后的昵称";
      document.querySelector("#profileForm").requestSubmit();
    });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).profile.name === "更新后的昵称");
    releaseQuick();
    await page.locator("#speechFailure").waitFor({ state: "visible" });
    await page.selectOption("#activeSpeaker", caregiver.id);
    releaseEnrichment();
    await waitForConversationPhase(page, "complete");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")));
    assert.equal(saved.profile.name, "更新后的昵称");
    assert.equal(saved.family.activeSpeakerId, caregiver.id);
    assert.equal(saved.messages.filter(message => message.role === "child").length, 1);
    const child = saved.messages.find(message => message.role === "child");
    const tutor = saved.messages.find(message => message.role === "tutor");
    assert.ok(child.turnId);
    assert.equal(child.turnId, tutor.turnId);
    assert.notEqual(child.id, tutor.id);
    assert.equal(saved.session.turnCount, 1);
    assert.deepEqual(saved.board, state.board, "Chat must preserve the existing drawing");
    assert.equal(await page.locator("#speechFailureText").innerText(), "你不想选颜色，那就不选。");
    assert.deepEqual(calls, ["quick", "enrichment"]);
    assert.equal(await page.evaluate(() => window.syntheticSystemSpeech), 0);
    const before = speechCalls;
    await page.locator("#retrySpeech").click();
    await page.locator("#speechFailure").waitFor({ state: "visible" });
    assert.ok(speechCalls > before);
    assert.equal(calls.length, 2, "Replaying audio must not create another model answer");
    assert.ok(spokenTexts.length > 0);
    assert.ok(spokenTexts.every(text => text === tutor.text), "Chat and replay must not narrate the old drawing");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `screenshots/conversation-consistency/${width}-${boardMode}.png` });
    assert.deepEqual(errors, []);
    console.log(`${width}px ${boardMode}: target identities, profile/speaker races, delivered reply, speech failure and replay passed`);
    await context.close();
    }
  }
} finally { await browser.close(); }
