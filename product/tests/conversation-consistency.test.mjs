import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createConversationTurn } from "../src/services/tutorEngine.js";
import { adaptTutorReply, getAgeInstruction } from "../src/content/ageAdaptation.js";
import { createQuickTutorReplyWithQwen, createTutorTurnWithQwen } from "../server/qwenTutor.mjs";
import { createVoiceController } from "../src/services/voiceService.js";

test("free conversation never starts a color lesson or revives a rejected story", () => {
  let state = createInitialState();
  state.activeLesson = { activity: "story", awaitingAnswer: true, story: { choices: ["红色", "蓝色"] } };
  for (const text of ["我不想选颜色", "我今天跟朋友一起玩", "蓝色是我喜欢的颜色", "我想听一个故事"]) {
    state = createConversationTurn(text, state);
    assert.equal(state.activeLesson, null);
    assert.equal(state.offlineTask, null);
    assert.doesNotMatch(state.messages.at(-1).text, /选|喜欢哪个|red|门/);
  }
  assert.equal(createConversationTurn("画一个房子", createInitialState()).visualPlan.changed, true);
});

test("length adaptation keeps the answer rather than prioritizing a trailing question", () => {
  assert.equal(adaptTutorReply("你说不想选。那就不选。我们换一个。你喜欢哪个颜色？", "3-4"), "你说不想选。 那就不选。");
  for (const age of ["3-4", "4-5", "5-6"]) assert.match(getAgeInstruction(age), /不必|不强行/);
});

test("enrichment sees delivered speech but cannot install a different question, activity or board", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  process.env.QWEN_API_KEY = "synthetic"; process.env.TUTOR_ENABLE_LLM = "true"; process.env.LLM_PROVIDER = "qwen";
  const state = createInitialState();
  const input = "我今天跟朋友一起玩";
  state.messages = [{ role: "child", text: input }];
  const spokenReply = "你们一起玩了一会儿。";
  globalThis.fetch = async (_, options) => {
    const request = JSON.parse(options.body);
    assert.equal(JSON.parse(request.messages[1].content).spokenReply, spokenReply);
    assert.match(request.messages[0].content, /不是第二次对话/);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      tutorReply: "你喜欢哪个颜色？", board: { type: "story", story: { choices: ["红色", "蓝色"] } },
      offlineTask: { title: "选颜色" }, growthEvidence: { shouldSave: false }
    }) } }] }));
  };
  try {
    const result = await createTutorTurnWithQwen(input, state, { spokenReply });
    assert.equal(result.llmStatus.used, true);
    assert.equal(result.messages.at(-1).text, spokenReply);
    assert.equal(result.activeLesson, null);
    assert.equal(result.offlineTask, null);
    assert.deepEqual(result.board, state.board);
    globalThis.fetch = async () => { throw new Error("synthetic failure"); };
    const local = createConversationTurn(input, state);
    const fallback = await createQuickTutorReplyWithQwen(input, state, local.messages.at(-1).text);
    assert.equal(fallback.llmStatus.fallback, true);
    assert.match(fallback.reply, /没连上/);
    assert.doesNotMatch(fallback.reply, /颜色|选择/);
  } finally { globalThis.fetch = oldFetch; process.env = oldEnv; }
});

test("failed cloud speech reports failure without switching to a system voice", async () => {
  const keys = ["window", "navigator", "fetch"];
  const saved = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let systemCalls = 0, errors = 0;
  const stages = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    Audio: function () {}, location: { protocol: "http:", hostname: "localhost" }, performance,
    speechSynthesis: { cancel() {}, speak() { systemCalls++; } }, setTimeout, clearTimeout
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  try {
    createVoiceController().speak("测试回应", { onError: () => errors++, onTiming: event => stages.push(event.stage) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(errors, 1); assert.equal(systemCalls, 0);
    assert.ok(stages.includes("tts-cloud-failed"));
  } finally {
    for (const k of keys) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  }
});
