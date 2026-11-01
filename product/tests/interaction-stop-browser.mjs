import { waitForConversationPhase, readRuntimeDiagnostics } from "./helpers/runtimeDiagnostics.mjs";
import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { normalizeLocalStudentDb } from "../src/data/localStudentDb.js";
import { createLocalArchiveExport } from "../src/services/storage.js";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const key = "xiaoyuji-learning-state-v1";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const failures = [];
const scenarios = [
  ["quick", "navigate"], ["quick", "hidden"], ["quick", "pagehide"], ["quick", "end"],
  ["quick", "replay"], ["quick", "microphone"], ["quick", "restore"], ["quick", "new-input"],
  ["enrichment", "navigate"], ["speech", "hidden"],
  ["route", "navigate"], ["plan", "hidden"], ["image", "navigate"]
];
try {
  for (const [stage, action] of scenarios) {
    const context = await browser.newContext({ viewport: { width: action === "navigate" ? 390 : 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const gate = deferred(), started = deferred(), errors = [], calls = [];
    const state = createInitialState();
    state.uiVersion = 4;
    state.profile = { ...state.profile, name: "模拟停止家庭", configured: true, consent: true };
    state.session = { id: "stop-test", status: "active", turnCount: 0 };
    if (["route", "plan", "image"].includes(stage)) state.board = resolveIllustrationPlan("画一个房子", state).board;
    await page.addInitScript(({ state, key }) => {
      localStorage.setItem(key, JSON.stringify(state));
      window.stopRequests = []; window.listeningStarts = 0;
      window.SpeechRecognition = class {
        start() { window.activeRecognition = this; window.listeningStarts++; this.onstart?.(); }
        abort() { this.onend?.(); } stop() { this.onend?.(); }
      };
      navigator.mediaDevices.getUserMedia = async () => { throw new Error("Synthetic test: no microphone"); };
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (url, options = {}) => {
        const item = { url: String(url), aborted: false, settled: false }; window.stopRequests.push(item);
        options.signal?.addEventListener("abort", () => { item.aborted = true; });
        // Ignore the actual abort: the application must also reject a successfully returned stale result.
        const result = await nativeFetch(url, { ...options, signal: undefined });
        item.settled = true;
        return result;
      };
    }, { state, key });
    page.on("pageerror", error => errors.push(error.message));
    const target = { quick: "/api/tutor/quick", enrichment: "/api/tutor", speech: "/api/speech",
      route: "/api/whiteboard/route", plan: "/api/whiteboard/plan", image: "/api/whiteboard/image" }[stage];
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      calls.push(path);
      const body = route.request().postData() ? route.request().postDataJSON() : {};
      if (path === target && body.input !== "换个新问题") { started.resolve(); await gate.promise; }
      let result = {};
      if (path === "/api/tutor/quick") result = { reply: body.input === "换个新问题" ? "我们来聊新问题。" : "我们看看这朵花。", llmStatus: { used: true } };
      if (path === "/api/tutor") result = { memory: { interests: ["不应写入的迟到兴趣"] }, llmStatus: { used: true } };
      if (path === "/api/whiteboard/route") result = { mode: stage === "image" ? "image" : "precise", operation: "create", instruction: "画草地", available: true };
      if (path === "/api/whiteboard/plan") result = { sourceRevision: body.board.scene?.revision ?? null,
        plan: resolveIllustrationPlan("屋顶改成蓝色", { board: body.board }) };
      if (path === "/api/whiteboard/image") result = { ok: true,
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=" };
      if (path.startsWith("/api/speech")) return route.fulfill({ status: 503, body: "Synthetic speech failure" });
      return route.fulfill({ json: result });
    });
    try {
      await page.goto(process.env.TEST_URL || "http://127.0.0.1:4197/");
      await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
      await page.evaluate(({ input, speech }) => {
        document.querySelector("#speakReplies").checked = speech;
        document.querySelector("#childInput").value = input;
        document.querySelector("#askForm").requestSubmit();
      }, { input: ["route", "plan", "image"].includes(stage) ? "把房子放在绿草地上" : "今天我发现一朵花", speech: stage === "speech" });
      let startTimer;
      try {
        await Promise.race([started.promise, new Promise((_, reject) => {
          startTimer = setTimeout(() => reject(new Error(`Missing ${stage} request`)), 10000);
        })]);
      } finally { clearTimeout(startTimer); }
      if (stage === "quick") {
        const waiting = await page.evaluate(key => ({ state: JSON.parse(localStorage.getItem(key)),
          db: JSON.parse(localStorage.getItem("xiaoyuji-local-student-db-v1") || "{}") }), key);
        assert.equal(waiting.state.messages.filter(m => m.role === "tutor").length, 0,
          "A candidate must be absent before stop, not just cleaned afterward");
        assert.equal(waiting.state.messages.at(-1).role, "child");
        assert.equal(waiting.state.session.turnCount, 0);
        assert.equal((waiting.db.growthMoments || []).length, 0);
      }
      if (action === "navigate") {
        await page.locator("#mobileMenuButton").click();
        await page.locator('#mobileDrawer [data-nav-action="parent"]').click();
      } else if (action === "hidden") await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      else if (action === "pagehide") await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
      else if (action === "replay") await page.evaluate(() => document.querySelector("#whiteboard").dispatchEvent(new CustomEvent("whiteboard-replay")));
      else if (action === "microphone") await page.evaluate(() => document.querySelector("[data-mic-refresh]").click());
      else if (action === "end" || action === "restore") await page.evaluate(() => document.querySelector("#endParentSession").click());
      if (action === "new-input") {
        await page.evaluate(() => {
          document.querySelector("#childInput").value = "换个新问题";
          document.querySelector("#askForm").requestSubmit();
        });
        await waitForConversationPhase(page, "complete");
      }
      if (action === "restore") {
        const imported = createInitialState(); imported.profile.name = "恢复后的模拟家庭";
        const backup = createLocalArchiveExport(imported, normalizeLocalStudentDb({}));
        await page.locator("#backupImportFile").setInputFiles({ name: "synthetic.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
        await page.locator("#restoreConsent").check();
        await page.locator('#restoreConfirmForm button[type="submit"]').click();
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).profile.name === "恢复后的模拟家庭", key);
      }
      const read = () => page.evaluate(key => ({ state: JSON.parse(localStorage.getItem(key)),
        db: localStorage.getItem("xiaoyuji-local-student-db-v1"), starts: window.listeningStarts }), key);
      const stopped = await read();
      const afterStopCalls = calls.length;
      const aborted = await page.evaluate(target => window.stopRequests.find(item => item.url === target)?.aborted, target);
      // Turn audio on only now: a wrongly accepted late quick reply would start TTS.
      await page.evaluate(() => { document.querySelector("#speakReplies").checked = true; });
      gate.resolve();
      await page.waitForFunction(target => window.stopRequests.find(item => item.url === target)?.settled, target);
      await page.waitForTimeout(350);
      assert.deepEqual(await read(), stopped, "Late result must not modify state, archive, or restart listening");
      assert.equal(calls.length, afterStopCalls, "Late result must not trigger enrichment or speech");
      assert.equal(aborted, true, "Stopping must abort the outstanding request");
      assert.equal(Boolean(stopped.state.llmStatus?.pending || stopped.state.llmStatus?.enrichmentPending), false);
      if (stage === "quick" && !["restore", "new-input"].includes(action)) assert.equal(stopped.state.messages.filter(m => m.role === "tutor").length, 0, "Unpublished candidate is not conversation history");
      if (action === "new-input") {
        assert.deepEqual(stopped.state.messages.filter(m => m.role === "tutor").map(m => m.text), ["我们来聊新问题。"]);
        assert.equal(stopped.state.session.turnCount, 1);
      }
      if (stage === "enrichment") assert.ok(stopped.state.messages.some(m => m.text === "我们看看这朵花。"), "Accepted answer remains");
      if (action === "hidden") await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
      if (action === "pagehide") await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      if (action === "navigate") {
        await page.locator("#mobileMenuButton").click();
        await page.locator('#mobileDrawer [data-nav-action="talk"]').click();
      }
      await page.waitForTimeout(300);
      assert.equal((await read()).starts, stopped.starts, "Returning must not automatically reopen microphone");
      if (stage === "quick" && action === "navigate") {
        await page.locator("#mainVoiceButton").dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
        await page.waitForFunction(() => window.listeningStarts === 1);
        assert.equal((await readRuntimeDiagnostics(page)).snapshots.conversation.awaitingReply, false, "An explicit new start must not be blocked by old work");
      }
      assert.deepEqual(errors, []);
      console.log(`PASS stop ${stage}/${action}: abort, late-result rejection, state cleanup and resume boundary`);
    } catch (error) { failures.push(`${stage}/${action}: ${error.message}`); console.error(`FAIL stop ${stage}/${action}: ${error.message}`); }
    finally { gate.resolve(); await context.close(); }
  }
} finally { await browser.close(); }
assert.deepEqual(failures, []);
