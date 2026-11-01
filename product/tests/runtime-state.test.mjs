import test from "node:test";
import assert from "node:assert/strict";
import { deriveVoiceUiState } from "../src/ui/voiceState.js";
import { createAppStore } from "../src/app/appStore.js";
import { normalizeApplicationState } from "../src/app/applicationState.js";
import { createInitialState } from "../src/data/studentModel.js";
import { createConversationController } from "../src/features/conversation/conversationController.js";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness() {
  const quick = deferred(), enrichment = deferred(), started = deferred();
  let live = { session: { id: "s", status: "active", turnCount: 0 }, messages: [] };
  const controller = createConversationController({ quickApi: () => quick.promise,
    enrichmentApi: () => { started.resolve(); return enrichment.promise; } });
  const turn = controller.begin({ sessionId: "s" });
  const receive = commit => {
    const result = controller.accept(turn, live, commit);
    controller.settle(turn, result.accepted, commit.kind, result.reason);
    assert.equal(result.accepted, true);
    live = result.state;
    return live;
  };
  const run = controller.run({ turn, stateForRequest: live, getState: () => live,
    localTurn: { ...live, messages: [{ role: "child", text: "发现一片叶子" }, { role: "tutor", text: "候选" }] },
    onPending: receive, onQuickReply: receive });
  return { controller, turn, quick, enrichment, started, run, receive, getState: () => live };
}

test("persistent application state contains diagnostics, never task progress or provider UI prose", () => {
  const status = { provider: "test", model: "fake", used: true, tokenUsage: { inputTokens: 12 },
    pending: true, enrichmentPending: true, stage: "enrichment", message: "旧状态文字" };
  const store = createAppStore({ ...createInitialState(), llmStatus: status }, { normalize: normalizeApplicationState });
  status.tokenUsage.inputTokens = 99;
  assert.deepEqual(store.getState().llmStatus, { provider: "test", model: "fake", used: true, tokenUsage: { inputTokens: 12 } });
  store.update(current => ({ ...current, llmStatus: { ...status, stage: "drawing-plan" } }));
  assert.equal(store.getState().llmStatus.stage, undefined);
  assert.equal(createConversationController().getSnapshot().phase, "idle", "Persisted diagnostics cannot resume a job");
});

test("quick acceptance releases foreground waiting while enrichment is still in flight", async () => {
  const h = harness();
  assert.equal(h.controller.getSnapshot().awaitingReply, true);
  assert.equal(h.getState().llmStatus.pending, undefined);
  h.quick.resolve({ reply: "一起看看吧", llmStatus: { used: true, stage: "quick-reply" } });
  await h.started.promise;
  assert.equal(h.controller.getSnapshot().phase, "enrichment");
  assert.equal(h.controller.getSnapshot().replyAccepted, true);
  assert.equal(h.controller.getSnapshot().awaitingReply, false);
  assert.equal(deriveVoiceUiState({ conversation: h.controller.getSnapshot() }).phase, "ready");
  h.enrichment.resolve(null);
  h.receive((await h.run).commit);
  assert.equal(h.controller.getSnapshot().phase, "complete");
});

for (const mode of ["clone", "diagnostics", "conflict"]) test(`one-time runtime acceptance: ${mode}`, async () => {
  const h = harness();
  h.quick.resolve({ reply: "看看吧", llmStatus: { used: false } });
  const outcome = await h.run;
  const live = h.getState();
  if (mode === "clone") {
    assert.equal(h.controller.accept(h.turn, live, structuredClone(outcome.commit)).accepted, false);
  }
  if (mode === "diagnostics") live.llmStatus = { model: "independent-diagnostic-update", used: true };
  if (mode === "conflict") {
    const changed = { ...live, messages: live.messages.map(m => m.role === "tutor" ? { ...m, text: "修订" } : m) };
    assert.equal(h.controller.accept(h.turn, changed, outcome.commit).reason, "reply-changed");
    assert.equal(h.controller.accept(h.turn, live, outcome.commit).accepted, false, "A rejected delivery is consumed, even if old state is later restored");
  } else {
    assert.equal(h.controller.accept(h.turn, live, outcome.commit).accepted, true);
    assert.equal(h.controller.accept(h.turn, live, outcome.commit).accepted, false);
  }
});

for (const [input, expected] of [
  [{ media: { input: "capturing" }, conversation: { phase: "complete", replyAccepted: true } }, "listening"],
  [{ media: { output: "playing" }, conversation: { phase: "enrichment", replyAccepted: true } }, "speaking"],
  [{ media: { output: "preparing" }, conversation: { phase: "complete", replyAccepted: true } }, "thinking"],
  [{ media: { failure: "playback" }, conversation: { phase: "complete", replyAccepted: true } }, "retry"],
  [{ media: { failure: "capture" } }, "retry"],
  [{ conversation: { awaitingReply: true } }, "thinking"],
  [{ drawingPlan: { phase: "pending" } }, "thinking"],
  [{ conversation: { phase: "failed", replyAccepted: false } }, "retry"],
  [{ conversation: { phase: "failed", replyAccepted: true } }, "ready"],
  [{ visible: false, media: { output: "playing" } }, "ready"]
]) test(`voice projection ${JSON.stringify(input)} -> ${expected}`, () => {
  assert.equal(deriveVoiceUiState(input).phase, expected);
});

test("a route/plan failure leaves the foreground retryable and a new turn clears it", () => {
  const c = createConversationController(), turn = c.begin();
  c.settle(turn, false, "route", "request-failed");
  assert.equal(c.getSnapshot().awaitingReply, false);
  assert.equal(deriveVoiceUiState({ conversation: c.getSnapshot() }).phase, "retry");
  c.cancel();
  assert.equal(deriveVoiceUiState({ conversation: c.getSnapshot() }).phase, "ready");
  c.begin();
  assert.equal(deriveVoiceUiState({ conversation: c.getSnapshot() }).phase, "thinking");
  c.cancel();
  assert.equal(deriveVoiceUiState({ conversation: c.getSnapshot() }).phase, "ready");
});
