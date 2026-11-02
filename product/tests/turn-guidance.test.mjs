import test from "node:test";
import assert from "node:assert/strict";
import { classifyChildTurn, turnGuidance } from "../server/turnGuidance.mjs";

test("child turns are classified from what was said", () => {
  const cases = { "嗯": "ack", "哦。": "ack", "好的": "ack", "我不知道": "dont-know", "不知道呀": "dont-know",
    "没有了": "short-answer", "不想说了": "done", "开心": "feeling", "好害怕": "feeling", "为什么会下雨": "question",
    "蚂蚁会游泳吗": "question", "我今天看到一只蜗牛": "share", "我不知道它叫什么名字，但是它有很多脚": "share", "": "empty" };
  for (const [input, kind] of Object.entries(cases)) assert.equal(classifyChildTurn(input), kind, input);
});

test("guidance forbids a question after a turn that already asked one, including a feeling answer", () => {
  const asked = [{ role: "tutor", text: "蜗牛爬得慢悠悠的。你是在哪里看到的？" }];
  const told = [{ role: "tutor", text: "蜗牛爬过的地方会留下一条亮晶晶的线。" }];
  assert.match(turnGuidance("嗯", asked), /不要以问题结尾/);
  assert.equal(/不要以问题结尾/.test(turnGuidance("嗯", told)), false);
  assert.match(turnGuidance("开心", asked), /不要以问题结尾/);
  assert.match(turnGuidance("说完了", told), /不另开话题/);
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
  for (const input of ["我现在不想想办法。", "她笑我画得丑。", "为什么会下雨？"]) {
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


test("explicit first-person refusal overrides sharing without swallowing new questions or narrated refusals", () => {
  for (const input of ["不知道，我现在不想说。", "我不想想办法。", "今天不想画了。", "我暂时不想回答。", "说完了。", "讲完了"]) {
    assert.equal(classifyChildTurn(input), "done", input);
    assert.match(turnGuidance(input), /不另开话题、任务或问题/);
  }
  for (const input of ["不想画了，为什么月亮会跟着我？", "我不想说这个了，但是蜗牛为什么有壳？", "小兔子不想回家，后来呢？"]) {
    assert.notEqual(classifyChildTurn(input), "done", input);
  }
  for (const input of ["她说她不想说了。", "小兔子说，不想说了。", "我说的是小兔不想画了。", "我不知道它叫什么名字，但是它有很多脚"]) {
    assert.equal(classifyChildTurn(input), "share", input);
  }
});

test("ambiguous short replies keep context available rather than asserting the child finished", () => {
  for (const input of ["没有了", "没了", "没有", "没事了", "没什么了"]) {
    assert.equal(classifyChildTurn(input), "short-answer", input);
    const guidance = turnGuidance(input, [{ role: "tutor", text: "今天那个水坑还在吗？" }]);
    assert.match(guidance, /结合上一轮/);
    assert.match(guidance, /物体/);
    assert.doesNotMatch(guidance, /孩子表示这件事说完了/);
  }
});

test("acknowledgment and uncertainty are contextual and do not force new content or feelings", () => {
  const ack = turnGuidance("嗯", [{ role: "tutor", text: "种在湿纸巾上了吗？" }]);
  assert.match(ack, /回答.*附和/);
  assert.doesNotMatch(ack, /没有新内容|直接说一个|接着给一个/);
  const unknown = turnGuidance("不知道", [{ role: "tutor", text: "你现在是什么感觉？" }]);
  assert.match(unknown, /感受/);
  assert.match(unknown, /说不清/);
  assert.doesNotMatch(unknown, /有趣的答案/);
  const feeling = turnGuidance("开心", [{ role: "tutor", text: "是什么感觉？我在听。" }]);
  assert.match(feeling, /不要以问题结尾/);
  assert.doesNotMatch(feeling, /再问一个/);
});

test("context-aware instructions reach both quick request modes without contradictory hook directives", async t => {
  const { createInitialState } = await import("../src/data/studentModel.js");
  const { createQuickTutorReplyWithQwen, streamQuickTutorReplyWithQwen } = await import("../server/qwenTutor.mjs");
  const keys = ["QWEN_API_KEY", "QWEN_BASE_URL", "TUTOR_ENABLE_LLM", "LLM_PROVIDER", "QUICK_TURN_GUIDANCE"];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => saved[i] === undefined ? delete process.env[key] : process.env[key] = saved[i]));
  Object.assign(process.env, { QWEN_API_KEY: "test-key", QWEN_BASE_URL: "https://example.invalid/v1", TUTOR_ENABLE_LLM: "true", LLM_PROVIDER: "qwen", QUICK_TURN_GUIDANCE: "true" });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    requests.push(JSON.parse(options.body));
    throw new Error("captured; no network");
  });
  for (const [input, previous] of [["不知道，我现在不想说。", "你最想说什么？"], ["开心", "和朋友一起玩是什么感觉？"], ["没有了", "水坑还在吗？"]]) {
    const state = createInitialState();
    state.messages.push({ role: "tutor", text: previous }, { role: "child", text: input });
    await createQuickTutorReplyWithQwen(input, state, "好的。");
    for await (const event of streamQuickTutorReplyWithQwen(input, state, "好的。")) { /* drain mocked fallback */ }
  }
  assert.equal(requests.length, 6);
  for (const [index, body] of requests.entries()) {
    assert.equal(body.stream, index % 2 === 1);
    const system = body.messages[0].content;
    assert.doesNotMatch(system, /不知道答案，不是不想说|只是听到了，不是拒绝|再问一个能让他说出具体画面|孩子说“没有了”“不想说了”/);
    assert.match(system, /容易接的话头/);
    assert.match(system, /不要连续两轮都以问题结尾/);
    if (index < 2) assert.doesNotMatch(system, /本轮指引：孩子在分享/);
    if (index >= 4) assert.match(system, /本轮指引：.*结合上一轮/);
  }
});
