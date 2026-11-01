import test from "node:test";
import assert from "node:assert/strict";
import { createConversationController } from "../src/features/conversation/conversationController.js";
import { applyConversationCommit, createConversationCommit } from "../src/features/conversation/conversationCommit.js";

function state() {
  return { session: { id: "test-session", status: "active", turnCount: 0 },
    profile: { name: "模拟家庭" }, family: { activeSpeakerId: "child" },
    board: { type: "blank" }, memory: { interests: [] }, studentModel: { studentId: "child" },
    messages: [{ role: "child", text: "聊聊今天" }, { role: "tutor", text: "本地回复" }] };
}

async function completed(enriched = { memory: { interests: ["画画"] } }, reply = "好的") {
  const local = state();
  let live = { ...local, messages: local.messages.slice(0, -2) };
  const controller = createConversationController({
    quickApi: async () => ({ reply, llmStatus: { used: true } }), enrichmentApi: async () => enriched
  });
  let quickCommit;
  const turn = controller.begin();
  const accept = (current, commit) => controller.accept(turn, current, commit);
  const outcome = await controller.run({ turn, input: "聊聊今天", localTurn: local,
    stateForRequest: live, getState: () => live, onPending: commit => { live = accept(live, commit).state; return live; },
    onQuickReply: commit => {
      quickCommit = commit;
      const applied = accept(live, commit);
      assert.equal(applied.accepted, true);
      live = applied.state;
      return live;
    } });
  return { live, outcome, quickCommit, accept, controller, turn };
}

test("controller publishes bounded asynchronous commits instead of application state", async () => {
  const { live, outcome, quickCommit } = await completed({ ...state(), memory: { interests: ["画画"] } });
  assert.equal(outcome.status, "complete");
  assert.equal(Object.hasOwn(outcome, "state"), false);
  for (const commit of [quickCommit, outcome.commit]) {
    for (const key of ["state", "profile", "family", "board", "messages", "session"]) assert.equal(Object.hasOwn(commit, key), false);
  }
  assert.equal(applyConversationCommit(live, outcome.commit).accepted, true);
});

test("changes after controller completion survive consumption, including evidence conflicts", async () => {
  const { live, outcome } = await completed();
  const latest = { ...live, profile: { name: "新昵称" }, board: { type: "image", revision: 2 },
    memory: { interests: ["家长修订"] } };
  const result = applyConversationCommit(latest, outcome.commit);
  assert.equal(result.accepted, true);
  assert.equal(result.state.profile, latest.profile);
  assert.equal(result.state.board, latest.board);
  assert.equal(result.state.memory, latest.memory);
  assert.deepEqual(result.conflicts, ["memory"]);
});

test("replaying a completed submission is rejected before save or other side effects", async () => {
  const { live, outcome, accept } = await completed();
  const first = accept(live, outcome.commit);
  const again = accept(first.state, outcome.commit);
  assert.equal(first.accepted, true);
  assert.equal(again.accepted, false);
  assert.equal(again.state, first.state);
});

for (const change of ["end", "session", "message", "cancel", "new-turn"]) {
  test(`commit consumption rejects ${change} changes after completion`, async () => {
    const { live, outcome, accept, controller } = await completed();
    if (change === "end") live.session = { ...live.session, status: "ended" };
    if (change === "session") live.session = { ...live.session, id: "new-session" };
    if (change === "message") live.messages = live.messages.slice(0, -1);
    if (change === "cancel") controller.cancel();
    if (change === "new-turn") controller.begin();
    assert.equal(accept(live, outcome.commit).accepted, false);
  });
}

test("unknown fields in a submission cannot replace application-owned fields", async () => {
  const { live, outcome } = await completed();
  const result = applyConversationCommit(live, { ...outcome.commit, profile: {}, board: {}, messages: [],
    evidence: { ...outcome.commit.evidence, family: {} } });
  assert.equal(result.state.profile, live.profile);
  assert.equal(result.state.board, live.board);
  assert.equal(result.state.messages, live.messages);
  assert.equal(result.state.family, live.family);
});

test("protected output is applied to current family and cannot be replayed", async () => {
  const { live, outcome, accept } = await completed(null, "告诉我你的家庭地址。");
  const latest = { ...live, profile: { name: "新昵称" } };
  const first = accept(latest, outcome.commit);
  assert.equal(first.accepted, true);
  assert.equal(first.state.profile, latest.profile);
  assert.equal(first.state.messages.length, 1);
  assert.equal(first.state.messages[0].safetyProtected, true);
  assert.equal(first.state.llmStatus.message, undefined);
  assert.equal(accept(first.state, outcome.commit).accepted, false);
});

test("quick commit inserts once even when its text matches an older accepted reply", () => {
  const current = state();
  current.messages = current.messages.map(message => ({ ...message, id: `t:${message.role}`, turnId: "t" }));
  const reply = current.messages.pop();
  current.messages.unshift({ role: "tutor", text: reply.text });
  current.llmStatus = { pending: true, stage: "quick-reply" };
  const commit = createConversationCommit(current, { ...current, messages: [...current.messages, reply],
    llmStatus: { pending: false, enrichmentPending: true } }, { kind: "quick", turnId: "t" });
  const first = applyConversationCommit(current, commit);
  assert.equal(first.accepted, true);
  assert.equal(first.state.session.turnCount, 1);
  assert.equal(first.state.llmStatus.pending, undefined);
  assert.equal(first.state.llmStatus.stage, undefined);
  assert.equal(first.state.messages.filter(message => message.id === "t:tutor").length, 1);
  const replay = applyConversationCommit(first.state, commit);
  assert.equal(replay.accepted, false);
  assert.equal(replay.state.session.turnCount, 1);
});

test("rejected delivery does not start enrichment even if the reply text is unchanged", async () => {
  const local = state();
  let live = { ...local, messages: local.messages.slice(0, -2) };
  const controller = createConversationController({
    quickApi: async () => ({ reply: "本地回复", llmStatus: { used: true } }),
    enrichmentApi: () => assert.fail("rejected reply must not be enriched")
  });
  const outcome = await controller.run({ turn: controller.begin(), input: "聊聊今天", localTurn: local,
    stateForRequest: live, getState: () => live, onPending: commit => { live = applyConversationCommit(live, commit).state; return live; }, onQuickReply: () => false });
  assert.equal(outcome.status, "cancelled");
});

test("model usage and knowledge provenance survive bounded completion without shared mutable objects", async () => {
  const source = { memory: { interests: ["画画"] }, llmStatus: { model: "fake-model",
    tokenUsage: { inputTokens: 12 }, knowledgeCardIds: ["fake-card"], unwanted: { raw: "ignored" } } };
  const { live, outcome } = await completed(source);
  source.memory.interests.push("late mutation");
  source.llmStatus.tokenUsage.inputTokens = 999;
  const result = applyConversationCommit(live, outcome.commit);
  assert.deepEqual(result.state.memory.interests, ["画画"]);
  assert.equal(result.state.llmStatus.tokenUsage.inputTokens, 12);
  assert.deepEqual(result.state.llmStatus.knowledgeCardIds, ["fake-card"]);
  assert.equal(result.state.llmStatus.unwanted, undefined);
});
