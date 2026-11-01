import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { normalizeLocalStudentDb } from "../src/data/localStudentDb.js";
import { createLocalArchiveExport } from "../src/services/storage.js";
import { waitForConversationPhase, readRuntimeDiagnostics } from "./helpers/runtimeDiagnostics.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const key = "xiaoyuji-learning-state-v1", dbKey = "xiaoyuji-local-student-db-v1";
const input = "今天发现一片叶子", reply = "你发现了一片叶子呀。";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const state = createInitialState();
  state.uiVersion = 4;
  state.profile = { ...state.profile, name: "模拟候选家庭", configured: true, consent: true };
  state.session = { id: "candidate-test", status: "active", turnCount: 1 };
  state.messages = [
    { id: "old:child", turnId: "old", role: "child", text: "上次的发现" },
    { id: "old:tutor", turnId: "old", role: "tutor", text: "上次已接受的回答" }
  ];
  return state;
}
async function open(state, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ state, key }) => localStorage.setItem(key, JSON.stringify(state)), { state, key });
  return { context, page, errors };
}
async function ready(page) {
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:4197/");
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
}
const read = page => page.evaluate(({ key, dbKey }) => ({ state: JSON.parse(localStorage.getItem(key)),
  db: JSON.parse(localStorage.getItem(dbKey) || "{}") }), { key, dbKey });
const waitStage = waitForConversationPhase;

try {
  for (const width of [390, 1440]) {
    const { context, page, errors } = await open(fixture(), width);
    const quick = deferred(), enrichment = deferred(), requests = [];
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().postData() ? route.request().postDataJSON() : {};
      if (["/api/tutor/quick", "/api/tutor"].includes(path)) requests.push({ path, body });
      if (path === "/api/tutor/quick") { await quick.promise; return route.fulfill({ json: { reply, llmStatus: { used: true } } }); }
      if (path === "/api/tutor") {
        await enrichment.promise;
        return route.fulfill({ json: { messages: [{ role: "tutor", text: "补全不得替换正式回答" }],
          memory: { interests: ["叶子"] }, llmStatus: { used: true } } });
      }
      assert.ok(!path.startsWith("/api/speech"), "This text acceptance test must not start audio");
      return route.fulfill({ json: {} });
    });
    try {
      await ready(page);
      const requested = page.waitForRequest(request => new URL(request.url()).pathname === "/api/tutor/quick");
      await page.evaluate(input => {
        document.querySelector("#speakReplies").checked = false;
        document.querySelector("#childInput").value = input;
        document.querySelector("#askForm").requestSubmit();
      }, input);
      await requested;
      const waiting = await read(page);
      assert.equal((await readRuntimeDiagnostics(page)).snapshots.conversation.awaitingReply, true);
      for (const field of ["pending", "enrichmentPending", "stage", "message"]) assert.equal(waiting.state.llmStatus?.[field], undefined);
      assert.deepEqual(waiting.state.messages.map(m => m.text), [...fixture().messages.map(m => m.text), input]);
      assert.equal(waiting.state.session.turnCount, 1);
      assert.equal((waiting.db.growthMoments || []).length, 0);
      const exported = await page.evaluate(async () => {
        const { createLocalArchiveExport } = await import("/src/services/storage.js");
        return createLocalArchiveExport(JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")));
      });
      assert.deepEqual(exported.state.messages, waiting.state.messages);
      assert.equal(requests[0].body.state.messages.filter(m => m.role === "tutor").length, 1);
      assert.equal(requests[0].body.state.messages.at(-1).text, input);
      quick.resolve();
      await waitStage(page, "enrichment");
      const accepted = await read(page);
      assert.deepEqual(accepted.state.messages.map(m => m.text), [...waiting.state.messages.map(m => m.text), reply]);
      assert.equal(accepted.state.session.turnCount, 2);
      assert.equal(accepted.db.growthMoments.length, 1);
      assert.equal(accepted.db.growthMoments[0].tutorResponse, reply);
      assert.equal(accepted.db.growthMoments[0].childQuote, input);
      enrichment.resolve();
      await waitStage(page, "complete");
      const completed = await read(page);
      assert.deepEqual(completed.state.messages, accepted.state.messages);
      assert.equal(completed.state.session.turnCount, 2);
      assert.equal(completed.db.growthMoments.length, 1);
      assert.equal(completed.db.growthMoments[0].tutorResponse, reply);
      assert.equal(requests.length, 2);
      assert.equal(requests[1].body.spokenReply, reply);
      assert.deepEqual(errors, []);
      console.log(`PASS candidates ${width}px: pending history/export/context, accepted growth, one count, enrichment isolation`);
    } finally { quick.resolve(); enrichment.resolve(); await context.close(); }
  }

  for (const mode of ["legacy-pending", "new-pending", "accepted-enrichment", "backup"]) {
    const saved = fixture();
    saved.messages.push({ id: "now:child", turnId: "now", role: "child", text: input });
    saved.llmStatus = { pending: true, stage: "quick-reply" };
    if (mode !== "new-pending") saved.messages.push({ id: "now:tutor", turnId: "now", role: "tutor", text: reply });
    if (mode === "accepted-enrichment") saved.llmStatus = { pending: false, enrichmentPending: true, stage: "enrichment" };
    const initial = mode === "backup" ? createInitialState() : saved;
    const { context, page, errors } = await open(initial);
    const requests = [];
    await page.route("**/api/**", route => { requests.push(route.request().method()); return route.fulfill({ json: {} }); });
    try {
      await ready(page);
      if (mode === "backup") {
        const backup = createLocalArchiveExport(saved, normalizeLocalStudentDb({}));
        await page.locator("#backupImportFile").setInputFiles({ name: "synthetic-candidate.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
        await page.locator("#restoreConsent").check();
        await page.locator('#restoreConfirmForm button[type="submit"]').click();
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).profile.name === "模拟候选家庭", key);
      }
      const recovered = await read(page);
      assert.equal((await readRuntimeDiagnostics(page)).snapshots.conversation.awaitingReply, false);
      assert.equal(Boolean(recovered.state.llmStatus?.pending || recovered.state.llmStatus?.enrichmentPending), false);
      if (mode === "backup") {
        // Existing backup policy restores the archive, not the interrupted chat.
        assert.equal(recovered.state.messages.length, 0);
        assert.equal(recovered.state.session.status, "idle");
      } else {
        const expected = mode === "legacy-pending" ? saved.messages.slice(0, -1) : saved.messages;
        assert.deepEqual(recovered.state.messages, expected);
        assert.equal(recovered.state.session.turnCount, saved.session.turnCount);
      }
      assert.equal(requests.filter(method => method === "POST").length, 0, "Recovery must not regenerate or play a reply");
      assert.deepEqual(errors, []);
      console.log(`PASS candidates recovery: ${mode}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
