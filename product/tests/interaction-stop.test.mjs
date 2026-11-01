import test from "node:test";
import assert from "node:assert/strict";
import { cancelPendingConversationState, recoverInterruptedConversationState } from "../src/features/conversation/conversationState.js";
import { createConversationController } from "../src/features/conversation/conversationController.js";

const pending = () => ({ session: { id: "s", status: "active", turnCount: 0 },
  messages: [{ role: "tutor", id: "old:tutor", turnId: "old", text: "同一句备用回复" },
    { role: "child", id: "now:child", turnId: "now", text: "我的发现" },
    { role: "tutor", id: "now:tutor", turnId: "now", text: "同一句备用回复" }],
  llmStatus: { pending: true, stage: "quick-reply" }, board: { type: "blank" } });

for (const stage of ["quick", "complete"]) test(`stop rejects an offered ${stage} delivery without changing history`, async () => {
  const controller = createConversationController({ quickApi: async () => ({ reply: "已返回回答", llmStatus: { used: false } }) });
  const turn = controller.begin();
  let live = { session: { id: "s", status: "active", turnCount: 0 }, messages: [{ role: "tutor", text: "历史" }] };
  const localTurn = { ...live, messages: [...live.messages, { role: "child", text: "我的发现" }, { role: "tutor", text: "候选" }] };
  const accept = commit => {
    const result = controller.accept(turn, live, commit);
    assert.equal(result.accepted, true);
    live = result.state;
    return live;
  };
  let stopped, rejected;
  const stopBeforeAccept = commit => {
    stopped = live;
    controller.cancel();
    rejected = controller.accept(turn, live, commit);
    return false;
  };
  const outcome = await controller.run({ turn, stateForRequest: live, localTurn, getState: () => live,
    onPending: accept, onQuickReply: stage === "quick" ? stopBeforeAccept : accept });
  if (stage === "complete") stopBeforeAccept(outcome.commit);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "stale-turn");
  assert.equal(rejected.state, stopped);
  assert.deepEqual(live.messages.map(m => m.text), stage === "quick" ? ["历史", "我的发现"] : ["历史", "我的发现", "已返回回答"]);
  assert.equal(live.session.turnCount, stage === "quick" ? 0 : 1);
  assert.equal(controller.getSnapshot().awaitingReply, false);
});

test("page recovery removes only an identifiable legacy candidate and leaves its source unchanged", () => {
  const saved = pending(), original = structuredClone(saved);
  const recovered = recoverInterruptedConversationState(saved);
  assert.deepEqual(recovered.messages.map(m => m.id), ["old:tutor", "now:child"]);
  assert.equal(recovered.llmStatus.pending, undefined);
  assert.equal(recovered.session.turnCount, 0);
  assert.deepEqual(saved, original);
  assert.equal(recoverInterruptedConversationState(recovered), recovered);
});

test("page recovery stops interrupted work without removing accepted or unidentified history", () => {
  for (const mode of ["new-pending", "enrichment", "drawing", "unidentified"]) {
    const saved = pending();
    if (mode === "new-pending") saved.messages.pop();
    if (mode === "enrichment") saved.llmStatus = { pending: false, enrichmentPending: true };
    if (mode === "drawing") saved.llmStatus.stage = "drawing-plan";
    if (mode === "unidentified") delete saved.messages.at(-1).turnId;
    const recovered = recoverInterruptedConversationState(saved);
    assert.equal(recovered.messages, saved.messages, mode);
    assert.equal(Boolean(recovered.llmStatus.pending || recovered.llmStatus.enrichmentPending), false, mode);
  }
});

test("stopping drawing work cannot remove the previous accepted tutor message", () => {
  const current = pending(); current.llmStatus.stage = "drawing-plan";
  const stopped = cancelPendingConversationState(current);
  assert.equal(stopped.messages, current.messages);
  assert.equal(stopped.llmStatus.pending, undefined);
});

test("repeated stop is idempotent and idle state does not require another archive write", () => {
  const stopped = cancelPendingConversationState(pending());
  assert.equal(cancelPendingConversationState(stopped), stopped);
  const idle = { messages: [], llmStatus: null };
  assert.equal(cancelPendingConversationState(idle), idle);
});
