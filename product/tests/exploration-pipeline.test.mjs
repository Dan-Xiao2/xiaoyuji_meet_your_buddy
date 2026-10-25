import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInitialState } from "../src/data/studentModel.js";
import { createConversationTurn } from "../src/services/tutorEngine.js";
import * as intent from "../src/services/conversationIntent.js";
import { createQuickTutorReplyWithQwen, createTutorTurnWithQwen } from "../server/qwenTutor.mjs";
import { solarContext } from "../server/scienceContext.mjs";
import { adaptTutorReply } from "../src/content/ageAdaptation.js";
import { resolveVisualPlan } from "../src/whiteboard/visualPlan.js";

const journey = JSON.parse(readFileSync(new URL("../benchmarks/fixtures/conversation-quality.json", import.meta.url)))
  .find(item => item.id === "discovery-question-correction-switch-end");

test("sharing a tower does not start a block-counting lesson", () => {
  for (const input of ["我今天搭了一座很高的积木塔。", "我搭了三座积木房子", "我第一次搭积木就成功了"]) {
    assert.equal(resolveVisualPlan(input), null, input);
  }
  assert.ok(resolveVisualPlan("我有五块积木，给爸爸两块")?.board);
});

test("switching away from drawing does not block a new explicit drawing request", () => {
  const board = resolveVisualPlan("画一个房子").board;
  assert.equal(resolveVisualPlan("换个话题，影子为什么跟着我？", { board }), null);
  assert.equal(intent.topicChangeDrawingInput("不聊叶子了，画一个房子"), "画一个房子");
  assert.ok(resolveVisualPlan("换个话题，画一个房子")?.board?.scene);
  assert.equal(resolveVisualPlan("换个话题，画一只斑马")?.needsPlanner, true);
});

test("explicit goodbye is a local control, not a failed model answer or growth evidence", async () => {
  const state = createInitialState();
  const text = journey.turns.at(-1).input;
  const local = createConversationTurn(text, state);
  assert.equal(local.messages.at(-1).text, journey.turns.at(-1).referenceReply);
  assert.equal(local.growthEvidence.shouldSave, false);
  const fetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Goodbye must not call a model"); };
  try {
    const result = await createQuickTutorReplyWithQwen(text, state, "旧的颜色问题？");
    assert.equal(result.reply, journey.turns.at(-1).referenceReply);
    assert.equal(result.llmStatus.fallback, false);
  } finally { globalThis.fetch = fetch; }
});

test("ending detection is bounded and does not confuse drawing cancellation, quoted speech or questions", () => {
  assert.equal(typeof intent.conversationEndReply, "function");
  for (const input of ["小宇再见", "我不想聊了", "先不聊了", "今天就到这里吧", "我要去吃饭了，拜拜"]) {
    assert.ok(intent.conversationEndReply(input), input);
    assert.equal(intent.isInteractionControl(input), true);
  }
  for (const input of ["不用画了", "不要了", "谢谢", "小鸟跟我说再见", "为什么要说再见？", "我不想聊叶子了，聊影子吧", "我去吃饭以后还想问你一个问题"]) {
    assert.equal(intent.conversationEndReply(input), null, input);
  }
  assert.equal(createConversationTurn("我不想聊了，有人打我", createInitialState()).safetyDecision?.protected, true);
});

test("an old solar subject cannot override a new discovery or explicit correction", () => {
  const state = { messages: [
    { role: "child", text: "太阳为什么发光？" },
    { role: "tutor", text: "太阳会发光。" },
    { role: "child", text: "我刚才发现一只蝴蝶" },
    { role: "child", text: "那它为什么会飞？" }
  ] };
  assert.equal(solarContext("那它为什么会飞？", state), false);
  assert.equal(solarContext("不是太阳，我说的是灯泡", state), false);
  assert.equal(solarContext("不聊太阳了，影子为什么会动？", state), false);
  assert.equal(solarContext("那它会一直亮吗？", { messages: state.messages.slice(0, 2) }), true);
});

test("synthetic journey passes ordered context and shared exploration rules to both model stages", async () => {
  const env = { ...process.env }, fetch = globalThis.fetch;
  process.env.QWEN_API_KEY = "synthetic";
  process.env.TUTOR_ENABLE_LLM = "true";
  process.env.LLM_PROVIDER = "qwen";
  let state = createInitialState();
  state.profile.ageBand = "5-6";
  let turnIndex = 0, calls = 0;
  globalThis.fetch = async (_, options) => {
    calls++;
    const request = JSON.parse(options.body);
    const payload = JSON.parse(request.messages[1].content);
    assert.equal(payload.speakerInput, journey.turns[turnIndex].input);
    assert.equal(payload.inputModality, "text");
    assert.equal(payload.imageAvailable, false);
    assert.ok(request.messages[0].content.includes(intent.explorationInstruction));
    if (turnIndex > 0) assert.ok(payload.recentMessages.includes(journey.turns[turnIndex - 1].input));
    const content = request.response_format ? JSON.stringify({
      tutorReply: "你想选什么颜色？", board: { type: "blank" },
      offlineTask: { title: "选颜色" }, growthEvidence: { shouldSave: false }
    }) : journey.turns[turnIndex].referenceReply;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  };
  try {
    for (const [i, turn] of journey.turns.entries()) {
      turnIndex = i;
      state.messages.push({ role: "child", speakerRole: "child", text: turn.input });
      const local = createConversationTurn(turn.input, state);
      assert.equal(Boolean(local.visualPlan?.changed), false);
      const reply = await createQuickTutorReplyWithQwen(turn.input, state, local.messages.at(-1).text);
      assert.equal(reply.reply, i === journey.turns.length - 1 ? turn.referenceReply : adaptTutorReply(turn.referenceReply, state.profile.ageBand));
      if (i === journey.turns.length - 1) break;
      const result = await createTutorTurnWithQwen(turn.input, state, { spokenReply: reply.reply });
      assert.equal(result.llmStatus.used, true);
      assert.equal(result.messages.at(-1).text, reply.reply);
      assert.equal(result.offlineTask, null);
      assert.equal(result.activeLesson, null);
      state = result;
    }
    assert.equal(calls, 8, "Four model turns, then a local farewell");
  } finally { globalThis.fetch = fetch; process.env = env; }
});
