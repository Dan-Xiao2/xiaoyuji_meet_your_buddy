import test from "node:test";
import assert from "node:assert/strict";
import { dropSelfFeeling } from "../server/qwenTutor.mjs";
import { getAgeInstruction } from "../src/content/ageAdaptation.js";

test("hollow self-feeling sentences are dropped, the rest of the reply is kept", () => {
  assert.equal(dropSelfFeeling("听到你开心，小宇也觉得心里暖暖的。是不是滑滑梯凉凉的？"), "是不是滑滑梯凉凉的？");
  assert.equal(dropSelfFeeling("滑下来像风一样快。我也跟着高兴。下次想试试倒着滑吗？"), "滑下来像风一样快。下次想试试倒着滑吗？");
  assert.equal(dropSelfFeeling("小宇也很开心。"), "小宇也很开心。", "a reply is never emptied");
  assert.equal(dropSelfFeeling("蜗牛背着小房子。"), "蜗牛背着小房子。");
  assert.equal(dropSelfFeeling("你开心的时候会跳起来吗？"), "你开心的时候会跳起来吗？", "asking about the child's feeling is fine");
});

test("age rules no longer tell the model it need not ask, but still forbid quizzing", () => {
  for (const age of ["3-4", "4-5"]) {
    assert.equal(getAgeInstruction(age).includes("不必提问"), false);
    assert.match(getAgeInstruction(age), /不强行/);
  }
});

test("the quick reply asks for a hook every turn and forbids hollow feelings and drawing invitations", async t => {
  const keys = ["QWEN_API_KEY", "QWEN_BASE_URL", "TUTOR_ENABLE_LLM", "LLM_PROVIDER"];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => saved[index] === undefined
    ? delete process.env[key] : process.env[key] = saved[index]));
  Object.assign(process.env, { QWEN_API_KEY: "test-key", QWEN_BASE_URL: "https://example.invalid/compatible-mode/v1", TUTOR_ENABLE_LLM: "true", LLM_PROVIDER: "qwen" });
  let body;
  t.mock.method(globalThis, "fetch", async (url, options) => { body = JSON.parse(options.body); throw new Error("captured"); });
  const { createQuickTutorReplyWithQwen } = await import("../server/qwenTutor.mjs");
  await createQuickTutorReplyWithQwen("我今天看到一只蜗牛", { profile: { ageBand: "4-5" }, messages: [] }, "好的。");
  assert.ok(body, "the mocked model request must execute before checking its instructions");
  const system = body.messages[0].content;
  assert.match(system, /容易接的话头/);
  assert.match(system, /不要连续两轮都以问题结尾/);
  assert.match(system, /话头不能是邀请画画、讲故事或看图/);
  assert.equal(system.includes("允许只回应不提问"), false);
});
