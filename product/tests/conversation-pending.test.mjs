import test from "node:test";
import assert from "node:assert/strict";
import { createConversationController } from "../src/features/conversation/conversationController.js";
import { applyConversationCommit, createConversationCommit } from "../src/features/conversation/conversationCommit.js";
import { cancelPendingConversationState } from "../src/features/conversation/conversationState.js";
import { createTutorContext } from "../src/services/tutorContext.js";
import { createLocalArchiveExport } from "../src/services/storage.js";

function fixture() {
  const base = { session: { id: "session", status: "active", turnCount: 0 },
    profile: { name: "旧昵称" }, family: { activeSpeakerId: "child" },
    messages: [{ role: "tutor", text: "以前的回复" }], board: { type: "blank" },
    memory: { interests: [] }, studentModel: { studentId: "child" }, activeLesson: { id: "old" } };
  const child = { role: "child", text: "今天发现花了" };
  const request = { ...base, messages: [...base.messages, child] };
  const local = { ...request, activeLesson: null, growthEvidence: { shouldSave: false },
    messages: [...request.messages, { role: "tutor", text: "本地备用" }] };
  return { base, request, local };
}

async function pendingSubmission({ latest, reject = false } = {}) {
  const { base, request, local } = fixture();
  let live = latest ? latest(base) : base, submission, calls = 0;
  const controller = createConversationController({ quickApi: async () => {
    calls++; return { reply: "看看这朵花", llmStatus: { used: false } };
  } });
  const outcome = await controller.run({ turn: controller.begin(), input: "今天发现花了",
    stateForRequest: request, localTurn: local, getState: () => live,
    onPending: commit => {
      submission = commit;
      if (reject) return false;
      const applied = applyConversationCommit(live, commit);
      assert.equal(applied.accepted, true);
      live = applied.state;
      return live;
    }, onQuickReply: () => false });
  return { base, request, local, live, submission, calls, outcome };
}

test("pending sends only the child and domain changes; latest profile, history and board survive", async () => {
  const result = await pendingSubmission({ latest: base => ({ ...base,
    profile: { name: "新昵称" }, board: { type: "image", revision: 2 },
    messages: [...base.messages, { role: "tutor", text: "并发新增" }] }) });
  assert.equal(result.submission.kind, "pending");
  for (const field of ["profile", "family", "session", "state", "messages", "board"]) {
    assert.equal(Object.hasOwn(result.submission, field), false);
  }
  assert.equal(result.live.profile.name, "新昵称");
  assert.equal(result.live.board.revision, 2);
  assert.deepEqual(result.live.messages.map(m => m.text), ["以前的回复", "并发新增", "今天发现花了"]);
  assert.equal(result.submission.child.role, "child");
  assert.equal(JSON.stringify(result.submission).includes("本地备用"), false);
  assert.equal(result.live.activeLesson, null);
  assert.equal(result.live.llmStatus.pending, undefined);
});

test("pending preserves an independently revised local domain", async () => {
  const { live } = await pendingSubmission({ latest: base => ({ ...base, activeLesson: { id: "parent-revised" } }) });
  assert.equal(live.activeLesson.id, "parent-revised");
});

test("rejected pending never starts a model request", async () => {
  const { outcome, calls } = await pendingSubmission({ reject: true });
  assert.equal(outcome.status, "cancelled");
  assert.equal(calls, 0);
});

test("pending for a replaced session is rejected before publication or API work", async () => {
  const { request, local, base } = fixture();
  const controller = createConversationController({ quickApi: () => assert.fail("stale request") });
  const outcome = await controller.run({ turn: controller.begin(), input: "今天发现花了",
    stateForRequest: request, localTurn: local,
    getState: () => ({ ...base, session: { id: "new", status: "active" } }),
    onPending: () => assert.fail("stale publication") });
  assert.equal(outcome.status, "cancelled");
});

test("pending is detached from the candidate, excludes extra fields and cannot be replayed", async () => {
  const { base, local, submission } = await pendingSubmission({ reject: true });
  local.messages.at(-1).text = "候选后来变了";
  const applied = applyConversationCommit(base, { ...submission, profile: {}, changes: { ...submission.changes, profile: {} } });
  assert.equal(applied.accepted, true);
  assert.equal(applied.state.messages.at(-1).text, "今天发现花了");
  assert.equal(applied.state.profile, base.profile);
  assert.equal(applyConversationCommit(applied.state, submission).accepted, false);
});

test("pending does not overwrite messages changed between creation and consumption", async () => {
  const { base, submission } = await pendingSubmission({ reject: true });
  const edited = { ...base, messages: [] };
  const result = applyConversationCommit(edited, submission);
  assert.equal(result.accepted, false);
  assert.equal(result.state, edited);
});

test("routing-to-chat pending updates the identified child instead of appending a duplicate", async () => {
  const { base, request, local } = fixture();
  const controller = createConversationController({ quickApi: async () => ({ reply: "好", llmStatus: { used: false } }) });
  const turn = controller.begin();
  request.messages.at(-1).id = `${turn.turnId}:child`;
  request.messages.at(-1).turnId = turn.turnId;
  let live = { ...base, messages: request.messages };
  await controller.run({ turn, input: "今天发现花了", stateForRequest: request, localTurn: local,
    getState: () => live, onPending: commit => {
      live = applyConversationCommit(live, commit).state;
      return live;
    }, onQuickReply: () => false });
  assert.equal(live.messages.filter(m => m.role === "child").length, 1);
  assert.equal(live.messages.at(-1).role, "child");
});

test("a waiting or rejected candidate never enters exports or later model history", async () => {
  const { live } = await pendingSubmission();
  assert.equal(JSON.stringify(createLocalArchiveExport(live)).includes("本地备用"), false);
  assert.equal(JSON.stringify(createTutorContext(live)).includes("本地备用"), false);
  const stopped = cancelPendingConversationState(live);
  assert.deepEqual(stopped.messages, live.messages);
  assert.equal(stopped.messages.at(-1).text, "今天发现花了");
  assert.equal(stopped.session.turnCount, 0);
});

test("stopping a new pending turn preserves the previous identified accepted reply", async () => {
  const { live } = await pendingSubmission({ latest: base => ({ ...base, messages: [
    { id: "old:child", turnId: "old", role: "child", text: "上次原话" },
    { id: "old:tutor", turnId: "old", role: "tutor", text: "上次已接受回答" }
  ] }) });
  const stopped = cancelPendingConversationState(live);
  assert.deepEqual(stopped.messages.map(m => m.text), ["上次原话", "上次已接受回答", "今天发现花了"]);
  assert.equal(stopped.messages, live.messages);
});

test("a prepared quick reply is absent until accepted and cannot overwrite an occupied reply identity", async () => {
  const { live, submission } = await pendingSubmission();
  const reply = { id: submission.replyMessageId, turnId: submission.turnId, role: "tutor", text: "已返回但未接受" };
  const commit = createConversationCommit(live, { ...live, messages: [...live.messages, reply],
    llmStatus: { pending: false, enrichmentPending: true } }, { kind: "quick", turnId: submission.turnId });
  assert.equal(live.messages.some(m => m.id === reply.id), false);
  const occupied = { ...live, messages: [...live.messages, { ...reply, text: "另一次已接受" }] };
  assert.equal(applyConversationCommit(occupied, commit).accepted, false);
  const edited = { ...live, messages: live.messages.map(m => m.id === submission.childMessageId ? { ...m, text: "修订原话" } : m) };
  assert.equal(applyConversationCommit(edited, commit).accepted, false);
  const accepted = applyConversationCommit(live, commit);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.state.messages.at(-1).text, reply.text);
  assert.equal(accepted.state.session.turnCount, 1);
  assert.equal(applyConversationCommit(accepted.state, commit).accepted, false);
});
