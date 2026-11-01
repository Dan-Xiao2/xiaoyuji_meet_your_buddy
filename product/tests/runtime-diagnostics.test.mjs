import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeDiagnostics } from "../src/app/runtimeDiagnostics.js";
import { createConversationController } from "../src/features/conversation/conversationController.js";
import { createConversationCommit, applyConversationCommit } from "../src/features/conversation/conversationCommit.js";
import { createDrawingJob } from "../src/whiteboard/openDrawing.js";
import { createDrawingRequestTracker } from "../src/features/drawing/drawingRequestTracker.js";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function conversationHarness() {
  const quick = deferred(), diagnostics = createRuntimeDiagnostics({ now: () => 12 });
  const controller = createConversationController({ trace: diagnostics.record, quickApi: () => quick.promise });
  const turn = controller.begin({ sessionId: "s", captureRevision: 7 });
  let state = { session: { id: "s", status: "active", turnCount: 0 }, messages: [], board: { type: "blank" } };
  const accept = commit => {
    const result = controller.accept(turn, state, commit);
    controller.settle(turn, result.accepted, commit.kind, result.reason);
    if (result.accepted) state = result.state;
    return result.accepted ? state : false;
  };
  const localTurn = { ...state, messages: [{ role: "child", text: "不可记录的原话" }, { role: "tutor", text: "不可记录的候选" }] };
  const run = controller.run({ turn, input: "不可记录的原话", stateForRequest: state, localTurn,
    onPending: accept, onQuickReply: accept, getState: () => state });
  diagnostics.register("conversation", controller.getSnapshot);
  return { controller, turn, quick, run, diagnostics, accept, getState: () => state,
    editSource() { state = { ...state, messages: state.messages.map(m => m.role === "child" ? { ...m, text: "修改后的原话" } : m) }; } };
}

test("diagnostics drops content, arbitrary error strings and unknown event fields; reads are detached", () => {
  const d = createRuntimeDiagnostics({ now: () => 23 });
  d.record("conversation.requested", { phase: "quick", sessionId: "s", turnId: "t", input: "儿童原话", reply: "回答", image: "data:image", reason: "任意错误原文" });
  d.record("包含原话的未知事件", { text: "不应出现" });
  d.register("media", () => ({ input: "capturing", text: "原文", error: "错误原文", captureRevision: 2 }));
  const first = d.read();
  assert.deepEqual(first.events, [{ sequence: 1, atMs: 23, type: "conversation.requested", phase: "quick", sessionId: "s", turnId: "t" }]);
  assert.deepEqual(first.snapshots.media, { input: "capturing", captureRevision: 2 });
  first.events[0].phase = "failed";
  first.snapshots.media.input = "idle";
  assert.equal(d.read().events[0].phase, "quick");
  assert.equal(d.read().snapshots.media.input, "capturing");
});

test("diagnostics has a fixed 256-event memory bound with an explicit dropped count", () => {
  const d = createRuntimeDiagnostics();
  for (let i = 0; i < 300; i++) d.record("media.listen-scheduled", { delayMs: i });
  assert.equal(d.read().events.length, 256);
  assert.equal(d.read().dropped, 44);
  assert.equal(d.read().events[0].sequence, 45);
});

test("conversation exposes pending identity and distinguishes result ready from application accepted", async () => {
  const h = conversationHarness();
  assert.equal(h.controller.getSnapshot().phase, "quick");
  assert.equal(h.controller.getSnapshot().childMessageId, `${h.turn.turnId}:child`);
  assert.throws(() => { h.controller.getSnapshot().phase = "complete"; }, TypeError);
  h.quick.resolve({ reply: "不可记录的回答", llmStatus: { used: false } });
  const outcome = await h.run;
  assert.equal(h.controller.getSnapshot().phase, "result-ready");
  h.accept(outcome.commit);
  assert.equal(h.controller.getSnapshot().phase, "complete");
  const trace = h.diagnostics.read().events;
  assert.equal(trace[0].captureRevision, 7);
  assert.ok(trace.some(e => e.type === "conversation.requested" && e.phase === "quick"));
  assert.ok(trace.some(e => e.type === "conversation.accepted" && e.phase === "complete"));
  assert.ok(!JSON.stringify(h.diagnostics.read()).includes("不可记录"));
});

test("late results carry the old turn identity without overwriting a new runtime snapshot", async () => {
  const h = conversationHarness();
  const next = h.controller.begin({ sessionId: "new-session" });
  const current = h.controller.getSnapshot();
  h.quick.resolve({ reply: "旧回答", llmStatus: { used: false } });
  assert.equal((await h.run).status, "cancelled");
  assert.deepEqual(h.controller.getSnapshot(), current);
  assert.equal(current.turnId, next.turnId);
  const rejection = h.diagnostics.read().events.find(e => e.type === "conversation.rejected");
  assert.equal(rejection.turnId, h.turn.turnId);
  assert.equal(rejection.sessionId, "s");
  assert.equal(rejection.reason, "stale-turn");
  h.controller.settle(h.turn, true, "complete");
  assert.equal(h.diagnostics.read().events.at(-1).type, "conversation.rejected");
  assert.equal(h.diagnostics.read().events.at(-1).reason, "stale-turn");
  assert.deepEqual(h.controller.getSnapshot(), current);
});

test("editing the source produces an explicit rejection reason without accepting a reply", async () => {
  const h = conversationHarness(); h.editSource();
  h.quick.resolve({ reply: "旧回答", llmStatus: { used: false } });
  assert.equal((await h.run).status, "cancelled");
  assert.equal(h.controller.getSnapshot().phase, "rejected");
  assert.equal(h.diagnostics.read().events.at(-1).reason, "source-changed");
});

test("request failures are visible without recording provider error content", async () => {
  const events = [];
  const c = createConversationController({ trace: (type, data) => events.push({ type, ...data }), quickApi: async () => { throw new Error("provider-secret"); } });
  let state = { session: { id: "s", status: "active" }, messages: [] };
  const local = { ...state, messages: [{ role: "child", text: "原话" }, { role: "tutor", text: "候选" }] };
  await assert.rejects(c.run({ turn: c.begin({ sessionId: "s" }), stateForRequest: state, localTurn: local,
    getState: () => state, onPending: commit => { state = applyConversationCommit(state, commit).state; return state; } }), /provider-secret/);
  assert.equal(c.getSnapshot().phase, "failed");
  assert.equal(events.at(-1).reason, "request-failed");
  assert.ok(!JSON.stringify(events).includes("provider-secret"));
});

test("commit rejection reports source, reply and session failures separately", () => {
  const state = { session: { id: "s", status: "active" }, llmStatus: { pending: true },
    messages: [{ id: "t:child", role: "child", text: "原话" }, { id: "t:tutor", role: "tutor", text: "候选" }] };
  const commit = createConversationCommit(state, state, { kind: "complete", turnId: "t" });
  for (const [changed, reason] of [
    [{ ...state, messages: state.messages.slice(1) }, "source-changed"],
    [{ ...state, messages: state.messages.slice(0, 1) }, "reply-changed"],
    [{ ...state, session: { id: "other", status: "active" } }, "session-changed"]
  ]) assert.equal(applyConversationCommit(changed, commit).reason, reason);
});

test("route/plan tracker follows turn cancellation and old completion cannot change the new request", () => {
  const events = [], tracker = createDrawingRequestTracker({ trace: (type, data) => events.push({ type, ...data }) });
  const first = new AbortController(), second = new AbortController();
  const old = tracker.begin({ turnId: "one", signal: first.signal }, { sessionId: "s", revision: 1 }, "route");
  first.abort();
  assert.equal(tracker.getSnapshot().phase, "cancelled");
  const current = tracker.begin({ turnId: "two", signal: second.signal }, { sessionId: "s", revision: 2 }, "plan");
  tracker.finish(old);
  assert.equal(tracker.getSnapshot().taskId, current.taskId);
  assert.equal(tracker.getSnapshot().phase, "pending");
  assert.equal(events.at(-1).reason, "stale-task");
  tracker.finish(current);
  second.abort();
  assert.equal(tracker.getSnapshot().phase, "complete");
  assert.equal(tracker.getSnapshot().stage, "plan");
});

test("image task identity is independent of route/plan cancellation and rejects its own late response", async () => {
  const events = [], job = createDrawingJob({ trace: (type, data) => events.push({ type, ...data }) });
  const image = deferred(), otherTurn = new AbortController();
  let commits = 0;
  const run = job.run(() => image.promise, () => commits++, () => assert.fail("unexpected failure"), { sessionId: "s", turnId: "t", baseRevision: 3 });
  const snapshot = job.getSnapshot(); otherTurn.abort();
  assert.deepEqual(job.getSnapshot(), snapshot);
  job.cancel(); image.resolve("ignored"); await run;
  assert.equal(commits, 0);
  assert.equal(job.getSnapshot().phase, "cancelled");
  assert.equal(events.at(-1).reason, "stale-task");
  assert.equal(events.at(-1).taskId, snapshot.taskId);
});

test("a rejected image publish is distinct from a successful HTTP result", async () => {
  const job = createDrawingJob();
  await job.run(async () => "image", () => false, () => assert.fail("unexpected failure"));
  assert.equal(job.getSnapshot().phase, "rejected");
});
