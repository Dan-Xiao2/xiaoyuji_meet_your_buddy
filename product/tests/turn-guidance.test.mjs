import test from "node:test";
import assert from "node:assert/strict";
import { classifyChildTurn, turnGuidance } from "../server/turnGuidance.mjs";

test("child turns are classified from what was said", () => {
  const cases = { "嗯": "ack", "哦。": "ack", "好的": "ack", "我不知道": "dont-know", "不知道呀": "dont-know",
    "没有了": "done", "不想说了": "done", "开心": "feeling", "好害怕": "feeling", "为什么会下雨": "question",
    "蚂蚁会游泳吗": "question", "我今天看到一只蜗牛": "share", "我不知道它叫什么名字，但是它有很多脚": "share", "": "empty" };
  for (const [input, kind] of Object.entries(cases)) assert.equal(classifyChildTurn(input), kind, input);
});

test("guidance forbids a question after a turn that already asked one, except to draw out a feeling", () => {
  const asked = [{ role: "tutor", text: "蜗牛爬得慢悠悠的。你是在哪里看到的？" }];
  const told = [{ role: "tutor", text: "蜗牛爬过的地方会留下一条亮晶晶的线。" }];
  assert.match(turnGuidance("嗯", asked), /不要以问题结尾/);
  assert.equal(/不要以问题结尾/.test(turnGuidance("嗯", told)), false);
  assert.equal(/不要以问题结尾/.test(turnGuidance("开心", asked)), false);
  assert.match(turnGuidance("没有了", told), /不要再问这件事/);
  assert.equal(turnGuidance("", told), "");
});

test("a finished branch is acknowledged without inventing a new topic or question", () => {
  const guidance = turnGuidance("不想说了", [{ role: "tutor", text: "还有什么想说的？" }]);
  assert.doesNotMatch(guidance, /再说一个|接下来想聊|新角度/);
  assert.match(guidance, /不另开话题/);
});

test("the same response boundaries reach full, quick and streamed provider requests, even without optional turn guidance", async t => {
  const { createInitialState } = await import("../src/data/studentModel.js");
  const { createTutorTurnWithQwen, createQuickTutorReplyWithQwen, streamQuickTutorReplyWithQwen } = await import("../server/qwenTutor.mjs");
  const saved = { ...process.env };
  Object.assign(process.env, { QWEN_API_KEY: "test-key", QWEN_BASE_URL: "https://example.invalid/v1", TUTOR_ENABLE_LLM: "true", QUICK_TURN_GUIDANCE: "false" });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  const requests = [];
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push(JSON.parse(options.body));
    throw new Error("request captured; no provider call");
  });
  for (const input of ["我现在不想想办法。", "她笑我说话慢。", "为什么会下雨？"]) {
    const state = createInitialState();
    state.profile.ageBand = "4-5";
    state.activeSpeaker = { role: "child", name: "虚构孩子" };
    await createTutorTurnWithQwen(input, state);
    await createQuickTutorReplyWithQwen(input, state, "我听到了。");
    for await (const event of streamQuickTutorReplyWithQwen(input, state, "我听到了。")) { /* exhaust local fallback */ }
  }
  assert.equal(requests.length, 9, "all three paths must reach the mocked provider for each ordinary input");
  for (const body of requests) {
    const system = body.messages.find(message => message.role === "system").content;
    assert.match(system, /孩子明确拒绝/);
    assert.match(system, /不编造他人动机/);
    assert.match(system, /优先于留话头/);
    assert.doesNotMatch(system, /换一个相关的新角度/, "refusal must not also instruct the model to prolong the branch");
  }
});
