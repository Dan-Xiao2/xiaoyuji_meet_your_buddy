import assert from "node:assert/strict";
import { readRuntimeDiagnostics, waitWithRuntimeDiagnostics, installRuntimeReader } from "./helpers/runtimeDiagnostics.mjs";
import { readFile, mkdir } from "node:fs/promises";
import { createInitialState } from "../src/data/studentModel.js";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const journey = JSON.parse(await readFile(new URL("../benchmarks/fixtures/conversation-quality.json", import.meta.url), "utf8"))
  .find(item => item.id === "discovery-question-correction-switch-end");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
await mkdir("screenshots/exploration-pipeline", { recursive: true });
try {
  for (const width of [390, 1440]) {
    for (const existingBoard of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const state = createInitialState();
      state.uiVersion = 4;
      state.profile = { ...state.profile, name: "虚构探索家庭", ageBand: "5-6", configured: true, consent: true };
      state.session = { id: "exploration-test", status: "active", turnCount: 0 };
      if (existingBoard) state.board = resolveIllustrationPlan("画一个房子", state).board;
      await page.addInitScript(initial => {
        localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(initial));
        window.listeningStarts = 0;
        window.SpeechRecognition = class {
          start() { window.activeRecognition = this; window.listeningStarts++; this.onstart?.(); }
          abort() { this.onend?.(); }
          stop() { this.onend?.(); }
        };
        window.emitSyntheticUtterance = text => {
          const recognition = window.activeRecognition;
          const result = [{ transcript: text }]; result.isFinal = true;
          recognition.onresult({ resultIndex: 0, results: [result] });
          recognition.onend();
        };
        navigator.mediaDevices.getUserMedia = async () => { throw new Error("No real microphone in tests"); };
        speechSynthesis.speak = () => { throw new Error("No system voice fallback"); };
      }, state);
      const calls = [], spoken = [], errors = [];
      let releaseQuick;
      const quickGate = new Promise(resolve => { releaseQuick = resolve; });
      const probeDiagnostics = width === 390 && !existingBoard;
      const waitAt = (boundary, predicate, arg) => waitWithRuntimeDiagnostics(page, boundary, () => page.waitForFunction(predicate, arg));
      let releaseLast;
      const lastGate = new Promise(resolve => { releaseLast = resolve; });
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith("/api/speech")) {
          spoken.push(route.request().postDataJSON().text);
          return route.fulfill({ status: 503, body: "Synthetic speech failure" });
        }
        let result = {};
        if (pathname === "/api/whiteboard/route") {
          calls.push({ pathname, input: route.request().postDataJSON().input });
          result = { mode: "chat" };
        } else if (["/api/tutor/quick", "/api/tutor"].includes(pathname)) {
          const body = route.request().postDataJSON();
          calls.push({ pathname, input: body.input });
          const index = journey.turns.findIndex(turn => turn.input === body.input);
          assert.ok(index >= 0 && index < 4, "Farewell must not request a model");
          if (index > 0) assert.ok(body.state.messages.some(message => message.text === journey.turns[index - 1].input));
          if (pathname === "/api/tutor/quick") {
            if (probeDiagnostics && index === 0) await quickGate;
            result = { reply: journey.turns[index].referenceReply, llmStatus: { used: true } };
          } else {
            if (existingBoard && index === 3) await lastGate;
            result = { ...body.state, messages: [...body.state.messages, { role: "tutor", text: "选一个颜色？" }],
              board: { type: "blank" }, activeLesson: null, offlineTask: { title: "错误的旧活动" },
              growthEvidence: { shouldSave: false }, llmStatus: { used: true } };
          }
        }
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) }).catch(error => {
          if (!existingBoard) throw error;
        });
      });
      await page.goto(process.env.TEST_URL || "http://127.0.0.1:4197/");
      await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
      await installRuntimeReader(page);
      await page.evaluate(() => { document.querySelector("#speakReplies").checked = false; });
      await page.locator("#mainVoiceButton").click();
      await waitAt("initial-listen", () => window.listeningStarts === 1);
      for (let index = 0; index < 4; index++) {
        await page.evaluate(text => window.emitSyntheticUtterance(text), journey.turns[index].input);
        if (probeDiagnostics && index === 0) {
          await page.waitForFunction(() => window.readTestRuntime().snapshots.conversation.phase === "quick");
          // Deliberately hold the response. Both waits must fail with the real application's trace.
          try {
            for (const boundary of ["injected-reply", "injected-auto-listen"]) {
              await assert.rejects(waitWithRuntimeDiagnostics(page, boundary, () => page.waitForFunction(kind => {
                if (kind === "injected-auto-listen") return window.listeningStarts >= 2;
                return !window.readTestRuntime().snapshots.conversation.awaitingReply;
              }, boundary, { timeout: 80 })), failure => {
                const diagnostic = failure.runtimeDiagnostics;
                assert.equal(diagnostic.snapshots.conversation.phase, "quick");
                const turn = diagnostic.snapshots.conversation;
                assert.equal(turn.sessionId, "exploration-test");
                assert.ok(turn.turnId);
                assert.ok(diagnostic.events.some(event => event.type === "conversation.requested" &&
                  event.phase === "quick" && event.turnId === turn.turnId && event.sessionId === turn.sessionId));
                const started = diagnostic.events.find(event => event.type === "conversation.started" && event.turnId === turn.turnId);
                assert.ok(diagnostic.events.some(event => event.type === "media.capture-completed" &&
                  event.captureRevision === started.captureRevision && event.sessionId === turn.sessionId));
                assert.ok(!JSON.stringify(diagnostic).includes("虚构探索家庭"));
                assert.ok(!JSON.stringify(diagnostic).includes(journey.turns[0].input));
                return true;
              });
            }
          } finally { releaseQuick(); }
          console.log("PASS diagnostic fault injection: reply and auto-listen timeouts contain runtime identity/stage without conversation content");
        }
        await waitAt("reply", reply => {
          const s = JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1"));
          return s.messages.at(-1)?.text === reply && window.readTestRuntime().snapshots.conversation.replyAccepted;
        }, journey.turns[index].referenceReply);
        if (!(existingBoard && index === 3)) {
          await waitAt("enrichment", () => window.readTestRuntime().snapshots.conversation.phase === "complete");
        }
        await waitAt("auto-listen", n => window.listeningStarts >= n, index + 2);
      }
      const diagnostic = await readRuntimeDiagnostics(page);
      assert.deepEqual(Object.keys(diagnostic.snapshots).sort(), ["conversation", "drawingImage", "drawingPlan", "media"]);
      assert.equal(diagnostic.events.filter(event => event.type === "conversation.accepted" && event.phase === "quick").length, 4);
      assert.ok(diagnostic.events.some(event => event.type === "media.listen-scheduled"));
      const beforeEnd = await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")));
      assert.deepEqual(beforeEnd.board, state.board);
      assert.equal(beforeEnd.activeLesson, null);
      assert.equal(beforeEnd.offlineTask, null);
      assert.equal(calls.filter(call => call.pathname === "/api/tutor/quick").length, 4);
      assert.equal(calls.filter(call => call.pathname === "/api/whiteboard/route" && call.input === journey.turns[3].input).length, 0);
      await page.screenshot({ path: `screenshots/exploration-pipeline/${width}-${existingBoard ? "drawing" : "blank"}.png` });
      await page.evaluate(text => {
        document.querySelector("#speakReplies").checked = true;
        window.emitSyntheticUtterance(text);
      }, journey.turns.at(-1).input);
      await waitAt("session-end", () => JSON.parse(localStorage.getItem("xiaoyuji-learning-state-v1")).session.status === "ended");
      const ended = await page.evaluate(() => localStorage.getItem("xiaoyuji-learning-state-v1"));
      const starts = await page.evaluate(() => window.listeningStarts);
      const count = calls.length;
      releaseLast();
      // Simulate late recognition callbacks and a late enrichment after explicit goodbye.
      await page.evaluate(() => window.emitSyntheticUtterance("再画一个房子"));
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => window.listeningStarts), starts);
      assert.equal(await page.evaluate(() => localStorage.getItem("xiaoyuji-learning-state-v1")), ended);
      assert.equal(calls.length, count);
      assert.ok(spoken.length > 0);
      assert.ok(spoken.every(text => text === journey.turns.at(-1).referenceReply));
      assert.equal(JSON.parse(ended).messages.filter(message => message.role === "child").length, 5);
      assert.deepEqual(errors, []);
      console.log(`${width}px ${existingBoard ? "existing drawing + late enrichment" : "blank board"}: five-turn exploration, automatic listening and explicit end passed (synthetic speech/model only)`);
      await context.close();
    }
  }
} finally { await browser.close(); }
