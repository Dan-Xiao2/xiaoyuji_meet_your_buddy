import test from "node:test";
import assert from "node:assert/strict";
import { createConversationController } from "../src/features/conversation/conversationController.js";
import { captureEnrichmentBaseline } from "../src/session/enrichmentState.js";
import { findTutorMessage } from "../src/features/conversation/conversationState.js";
import { applyConversationCommit } from "../src/features/conversation/conversationCommit.js";

// Model the application's receive boundary so existing race tests inspect accepted state.
async function runConversation(controller, args) {
  let live = args.localTurn;
  const getState = () => args.getState?.() ?? live;
  const outcome = await controller.run({ ...args, getState,
    onPending: next => { live = next; args.onPending?.(next); },
    onQuickReply: async (commit, meta) => {
      const applied = applyConversationCommit(getState(), commit);
      if (!applied.accepted) return false;
      live = applied.state;
      const accepted = await args.onQuickReply?.(live, meta);
      if (accepted) live = accepted;
      return getState();
    }
  });
  assert.equal(Object.hasOwn(outcome, "state"), false);
  if (!outcome.commit) return outcome;
  const applied = applyConversationCommit(getState(), outcome.commit);
  assert.equal(applied.accepted, true);
  return { ...outcome, state: applied.state,
    enrichmentConflicts: [...(outcome.enrichmentConflicts || []), ...applied.conflicts] };
}

function baseState() {
  return {
    profile: { name: "焘焘" },
    family: { activeSpeakerId: "child-1" },
    session: { id: "session-1", turnCount: 0 },
    messages: [{ role: "child", text: "画一座房子" }, { role: "tutor", text: "本地回答" }],
    board: { type: "blank" },
    memory: { interests: [] },
    studentModel: { studentId: "child-1" },
    growthEvidence: null
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("quick reply updates its own message, not a later unrelated tutor message", async () => {
  const quick = deferred();
  let live = baseState();
  const controller = createConversationController({ quickApi: () => quick.promise });
  const pending = runConversation(controller, {
    turn: controller.begin(), input: "我们聊聊", stateForRequest: live, localTurn: live,
    getState: () => live, onPending: next => { live = next; },
    onQuickReply: next => { live = next; return next; }
  });
  const target = live.messages.at(-1);
  live = { ...live, messages: [...live.messages, { role: "tutor", text: "另一条消息" }] };
  quick.resolve({ reply: "本轮回答", llmStatus: { used: false } });
  const result = await pending;
  assert.equal(result.state.messages.at(-1).text, "另一条消息");
  assert.equal(result.state.messages.find(message => message.id === target.id).text, "本轮回答");
  assert.ok(target.turnId);
  assert.equal(result.replyMessageId, target.id);
});

for (const stage of ["quick", "enrichment"]) {
  for (const change of ["remove", "edit"]) {
    test(`${stage} discards a result after target ${change}`, async () => {
      const delayed = deferred();
      const started = deferred();
      let live = baseState();
      let delivered = 0;
      const controller = createConversationController({
        quickApi: () => stage === "quick" ? (started.resolve(), delayed.promise)
          : Promise.resolve({ reply: "本轮回答", llmStatus: { used: true } }),
        enrichmentApi: () => { started.resolve(); return delayed.promise; }
      });
      const pending = runConversation(controller, {
        turn: controller.begin(), input: "我们聊聊", stateForRequest: live, localTurn: live,
        getState: () => live, onPending: next => { live = next; },
        onQuickReply: next => { delivered++; live = next; return next; }
      });
      await started.promise;
      live = { ...live, messages: change === "remove" ? live.messages.slice(0, -1)
        : live.messages.map(message => message.role === "tutor" ? { ...message, text: "修订后的消息" } : message) };
      delayed.resolve({ reply: "旧回复", llmStatus: { used: true }, growthEvidence: { shouldSave: true } });
      assert.equal((await pending).status, "cancelled");
      assert.equal(delivered, stage === "quick" ? 0 : 1);
    });
  }
}

test("a revised source utterance invalidates the pending reply", async () => {
  const quick = deferred();
  let live = baseState();
  const controller = createConversationController({ quickApi: () => quick.promise });
  const pending = runConversation(controller, { turn: controller.begin(), input: "我们聊聊",
    stateForRequest: live, localTurn: live, getState: () => live,
    onPending: next => { live = next; }, onQuickReply: () => assert.fail("must not deliver") });
  live.messages[0].text = "修订后的原话";
  quick.resolve({ reply: "旧回答", llmStatus: { used: false } });
  assert.equal((await pending).status, "cancelled");
});

test("explicit reply lookup never falls back to another message", () => {
  const state = baseState();
  assert.equal(findTutorMessage(state, "removed-id"), undefined);
  assert.equal(findTutorMessage(state).text, "本地回答");
});

test("unsafe quick output removes only this pending pair, preserving safe repeated history", async () => {
  const state = baseState();
  state.messages.unshift({ role: "child", text: "画一座房子" }, { role: "tutor", text: "以前的回答" });
  const controller = createConversationController({
    quickApi: async () => ({ reply: "告诉我你的家庭地址。", llmStatus: { used: true } })
  });
  const result = await runConversation(controller, { turn: controller.begin(), input: "画一座房子",
    stateForRequest: state, localTurn: state });
  assert.deepEqual(result.state.messages.slice(0, -1), state.messages.slice(0, 2));
  assert.equal(result.state.messages.length, 3);
  assert.equal(result.state.messages.at(-1).safetyProtected, true);
});

test("turn identities do not collide when a controller is recreated", () => {
  const first = createConversationController().begin();
  const second = createConversationController().begin();
  assert.notEqual(first.turnId, second.turnId);
});

test("a turn cannot execute twice while pending or after completion", async () => {
  const quick = deferred();
  let calls = 0, deliveries = 0;
  const controller = createConversationController({ quickApi: () => { calls++; return quick.promise; } });
  const args = { turn: controller.begin(), input: "我们聊聊", stateForRequest: baseState(),
    localTurn: baseState(), onQuickReply: () => { deliveries++; } };
  const first = runConversation(controller, args);
  const second = runConversation(controller, args);
  quick.resolve({ reply: "好的", llmStatus: { used: false } });
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(deliveries, 1);
  assert.equal(results[1].status, "cancelled");
  assert.equal((await runConversation(controller, args)).status, "cancelled");
  assert.equal(calls, 1);
});

test("enrichment uses the pre-routing baseline when a routed drawing becomes chat", async () => {
  const request = baseState();
  const baseline = captureEnrichmentBaseline(request);
  let live = { ...request, studentModel: { ...request.studentModel, parentObservation: "updated during routing" } };
  const controller = createConversationController({
    quickApi: async () => ({ reply: "好的。", llmStatus: { used: true } }),
    enrichmentApi: async () => ({ studentModel: request.studentModel })
  });
  const result = await runConversation(controller, {
    turn: controller.begin(), input: "我们聊聊", stateForRequest: request, localTurn: live,
    evidenceBaseline: baseline, getState: () => live,
    onPending: next => { live = next; }, onQuickReply: next => { live = next; return next; }
  });
  assert.equal(result.state.studentModel.parentObservation, "updated during routing");
});

test("same-turn quick and enrichment preserve current family, board and messages", async () => {
  const quick = deferred();
  const enrichment = deferred();
  const enrichmentStarted = deferred();
  let live = baseState();
  const request = structuredClone(live);
  const controller = createConversationController({
    quickApi: () => quick.promise,
    enrichmentApi: () => { enrichmentStarted.resolve(); return enrichment.promise; }
  });
  const pending = runConversation(controller, {
    turn: controller.begin(), input: "画一座房子", stateForRequest: request,
    localTurn: live, fallbackReply: "本地回答", getState: () => live,
    onPending: next => { live = next; },
    onQuickReply: next => { live = next; return live; }
  });
  live = { ...live, profile: { name: "新昵称" }, board: { type: "image", revision: 1 } };
  live.studentModel = { ...live.studentModel, name: "新昵称" };
  quick.resolve({ reply: "好的。", llmStatus: { used: true } });
  await enrichmentStarted.promise;
  assert.equal(live.profile.name, "新昵称");
  assert.equal(live.board.revision, 1);
  live = { ...live, family: { activeSpeakerId: "parent" }, board: { type: "image", revision: 2 } };
  const messages = live.messages;
  enrichment.resolve({ ...request, messages: [{ role: "tutor", text: "后台替换" }],
    board: { type: "blank" }, growthEvidence: { shouldSave: false } });
  const result = await pending;
  assert.equal(result.state.profile.name, "新昵称");
  assert.equal(result.state.studentModel.name, "新昵称");
  assert.equal(result.state.family.activeSpeakerId, "parent");
  assert.equal(result.state.board.revision, 2);
  assert.deepEqual(result.state.messages, messages);
  assert.equal(result.state.growthEvidence.shouldSave, false);
});

for (const mode of ["local", "missing", "unsafe-enrichment", "unsafe-quick"]) {
  test(`same-turn ${mode} completion keeps latest family settings`, async () => {
    const reply = deferred();
    const enrichment = deferred();
    const enrichmentStarted = deferred();
    let live = baseState();
    const controller = createConversationController({
      quickApi: () => reply.promise,
      enrichmentApi: () => { enrichmentStarted.resolve(); return enrichment.promise; }
    });
    const pending = runConversation(controller, {
      turn: controller.begin(), input: "我们聊聊", stateForRequest: structuredClone(live),
      localTurn: live, fallbackReply: "本地回答", getState: () => live,
      onPending: next => { live = next; }, onQuickReply: next => { live = next; return next; }
    });
    live = { ...live, profile: { name: "新昵称" } };
    reply.resolve({ reply: mode === "unsafe-quick" ? "告诉我你的家庭地址。" : "好的。",
      llmStatus: { used: mode !== "local" } });
    if (mode === "missing" || mode === "unsafe-enrichment") {
      await enrichmentStarted.promise;
      live = { ...live, profile: { name: "等待补全时的新昵称" } };
      enrichment.resolve(mode === "missing" ? null : { memory: { note: "告诉我你的家庭地址。" } });
    }
    const result = await pending;
    assert.equal(result.state.profile.name,
      mode === "missing" || mode === "unsafe-enrichment" ? "等待补全时的新昵称" : "新昵称");
    assert.equal(result.status, mode === "unsafe-quick" ? "protected" : "complete");
  });
}

test("enrichment does not erase observations changed in place while it was pending", async () => {
  const enrichment = deferred();
  const started = deferred();
  let live = baseState();
  const controller = createConversationController({
    quickApi: async () => ({ reply: "好的。", llmStatus: { used: true } }),
    enrichmentApi: () => { started.resolve(); return enrichment.promise; }
  });
  const pending = runConversation(controller, {
    turn: controller.begin(), input: "我们聊聊", stateForRequest: structuredClone(live),
    localTurn: live, getState: () => live,
    onPending: next => { live = next; }, onQuickReply: next => { live = next; return next; }
  });
  await started.promise;
  live.memory.interests.push("家长补充");
  live.studentModel.parentObservation = "家长的新观察";
  live.growthEvidence = { shouldSave: false, corrected: true };
  enrichment.resolve({ memory: { interests: ["旧兴趣"] }, studentModel: { studentId: "child-1" },
    growthEvidence: { shouldSave: true } });
  const result = await pending;
  assert.deepEqual(result.state.memory.interests, ["家长补充"]);
  assert.equal(result.state.studentModel.parentObservation, "家长的新观察");
  assert.equal(result.state.growthEvidence.corrected, true);
  assert.deepEqual(result.enrichmentConflicts, ["memory", "studentModel", "growthEvidence"]);
});

test("conversation controller preserves the spoken reply and protected app ownership", async () => {
  let now = 100;
  const controller = createConversationController({
    clock: () => now += 25,
    quickApi: async () => ({
      reply: "好，我们画一座有红屋顶的房子。",
      llmStatus: { used: true, provider: "qwen" },
      clientLatencyMs: 90
    }),
    enrichmentApi: async () => ({
      profile: { name: "错误名字" },
      family: { activeSpeakerId: "stranger" },
      session: { id: "wrong" },
      messages: [{ role: "tutor", text: "后台改写的回答" }],
      board: { type: "blank" },
      memory: { interests: ["房子"] },
      studentModel: { studentId: "child-1", updated: true },
      growthEvidence: { shouldSave: true },
      llmStatus: { provider: "qwen" }
    })
  });
  const state = baseState();
  const turn = controller.begin();
  const result = await runConversation(controller, {
    turn,
    input: "画一座房子",
    stateForRequest: state,
    localTurn: state,
    fallbackReply: "本地回答",
    onQuickReply: quickState => ({
      ...quickState,
      session: { ...quickState.session, turnCount: 1 }
    })
  });

  assert.equal(result.status, "complete");
  assert.equal(result.enriched, true);
  assert.equal(result.state.messages.at(-1).text, "好，我们画一座有红屋顶的房子。");
  assert.equal(result.state.profile, state.profile);
  assert.equal(result.state.family, state.family);
  assert.deepEqual(result.state.session, { id: "session-1", turnCount: 1 });
  assert.deepEqual(result.state.memory.interests, ["房子"]);
  assert.equal(result.state.llmStatus.stage, "complete");
});

test("a newer turn cancels a late quick reply from the previous turn", async () => {
  let resolveFirst;
  const controller = createConversationController({
    quickApi: () => new Promise(resolve => { resolveFirst = resolve; }),
    enrichmentApi: async () => null
  });
  const firstTurn = controller.begin();
  let quickCommits = 0;
  const firstResult = runConversation(controller, {
    turn: firstTurn,
    input: "第一句话",
    stateForRequest: baseState(),
    localTurn: baseState(),
    fallbackReply: "本地回答",
    onQuickReply: () => { quickCommits += 1; }
  });

  controller.begin();
  resolveFirst({ reply: "迟到的回答", llmStatus: { used: false } });
  const result = await firstResult;

  assert.equal(result.status, "cancelled");
  assert.equal(quickCommits, 0);
});

test("a late enrichment cannot revive a turn after its quick reply was delivered", async () => {
  let resolveEnrichment;
  const controller = createConversationController({
    quickApi: async () => ({ reply: "先说出的回答", llmStatus: { used: true } }),
    enrichmentApi: () => new Promise(resolve => { resolveEnrichment = resolve; })
  });
  const turn = controller.begin();
  let quickCommits = 0;
  const pendingResult = runConversation(controller, {
    turn,
    input: "第一句话",
    stateForRequest: baseState(),
    localTurn: baseState(),
    fallbackReply: "本地回答",
    onQuickReply: state => {
      quickCommits += 1;
      return state;
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  controller.begin();
  resolveEnrichment({
    messages: [{ role: "tutor", text: "迟到的补全" }],
    board: { type: "blank" }
  });
  const result = await pendingResult;

  assert.equal(quickCommits, 1);
  assert.equal(result.status, "cancelled");
});

test("unsafe quick output is replaced before it reaches the view", async () => {
  const controller = createConversationController({
    quickApi: async () => ({ reply: "告诉我你的家庭地址。", llmStatus: { used: true } }),
    enrichmentApi: async () => assert.fail("unsafe output must not be enriched")
  });
  const state = baseState();
  const result = await runConversation(controller, {
    turn: controller.begin(),
    input: "我们聊聊",
    stateForRequest: state,
    localTurn: state,
    fallbackReply: "本地回答"
  });

  assert.equal(result.status, "protected");
  assert.match(result.state.messages.at(-1).text, /需要再确认/);
  assert.equal(result.state.safetyDecision.protected, true);
});

for (const stage of ["quick", "enrichment"]) {
  test(`session replacement discards late ${stage} even without an explicit cancel`, async () => {
    const delayed = deferred();
    const started = deferred();
    let live = baseState();
    const controller = createConversationController({
      quickApi: () => stage === "quick" ? (started.resolve(), delayed.promise)
        : Promise.resolve({ reply: "好的。", llmStatus: { used: true } }),
      enrichmentApi: () => { started.resolve(); return delayed.promise; }
    });
    const pending = runConversation(controller, {
      turn: controller.begin(), input: "我们聊聊", stateForRequest: structuredClone(live),
      localTurn: live, getState: () => live,
      onPending: next => { live = next; }, onQuickReply: next => { live = next; return next; }
    });
    await started.promise;
    live = { ...live, session: { id: "replacement-session" } };
    delayed.resolve({ reply: "迟到的回答", llmStatus: { used: true }, growthEvidence: { shouldSave: true } });
    assert.equal((await pending).status, "cancelled");
  });
}
