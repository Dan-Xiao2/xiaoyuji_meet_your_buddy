import test from "node:test";
import assert from "node:assert/strict";
import { createTutorContext } from "../src/services/tutorContext.js";

test("an interrupted reply keeps its mark into the model history, labelled as possibly unheard", async t => {
  const context = createTutorContext({ messages: [
    { role: "child", text: "我今天去公园玩了", interrupted: true },
    { role: "tutor", text: "公园里有软软的沙子。", speakerName: "小宇", interrupted: true },
    { role: "tutor", text: "完整听完的回答。", speakerName: "小宇" }
  ] });
  assert.equal("interrupted" in context.messages[0], false, "only Xiaoyu's replies can be interrupted");
  assert.equal(context.messages[1].interrupted, true);
  assert.equal("interrupted" in context.messages[2], false);

  const keys = ["QWEN_API_KEY", "QWEN_BASE_URL", "TUTOR_ENABLE_LLM", "LLM_PROVIDER"];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => saved[index] === undefined
    ? delete process.env[key] : process.env[key] = saved[index]));
  Object.assign(process.env, { QWEN_API_KEY: "test-key", QWEN_BASE_URL: "https://example.invalid/compatible-mode/v1", TUTOR_ENABLE_LLM: "true", LLM_PROVIDER: "qwen" });
  let body;
  t.mock.method(globalThis, "fetch", async (url, options) => { body = JSON.parse(options.body); throw new Error("captured"); });
  const { createQuickTutorReplyWithQwen } = await import("../server/qwenTutor.mjs");
  await createQuickTutorReplyWithQwen("没有软软的沙子", { ...context, profile: { ageBand: "4-5" } }, "好的。");
  assert.ok(body, "the mocked model request must execute before checking its history");
  const history = JSON.parse(body.messages[1].content).recentMessages;
  assert.match(history, /小宇（说到一半被孩子打断，孩子可能没听完）: 公园里有软软的沙子。/);
  assert.match(history, /小宇: 完整听完的回答。/);
  assert.match(body.messages[0].content, /不要猜成它的反面/);
});

test("when the page knows which sentences were played, only those are given as said", async t => {
  const context = createTutorContext({ messages: [
    { role: "tutor", text: "蜗牛背着小房子。它爬过的地方亮晶晶的。", speakerName: "小宇", interrupted: true, heard: "蜗牛背着小房子。" },
    { role: "tutor", text: "你想不想去找找？", speakerName: "小宇", interrupted: true, heard: "" },
    { role: "tutor", text: "不是开头的部分。", speakerName: "小宇", interrupted: true, heard: "别的话" }
  ] });
  assert.equal(context.messages[0].heard, "蜗牛背着小房子。");
  assert.equal(context.messages[1].heard, "");
  assert.equal("heard" in context.messages[2], false, "text that is not the start of the reply is dropped");

  const keys = ["QWEN_API_KEY", "QWEN_BASE_URL", "TUTOR_ENABLE_LLM", "LLM_PROVIDER"];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => saved[index] === undefined
    ? delete process.env[key] : process.env[key] = saved[index]));
  Object.assign(process.env, { QWEN_API_KEY: "test-key", QWEN_BASE_URL: "https://example.invalid/compatible-mode/v1", TUTOR_ENABLE_LLM: "true", LLM_PROVIDER: "qwen" });
  let body;
  t.mock.method(globalThis, "fetch", async (url, options) => { body = JSON.parse(options.body); throw new Error("captured"); });
  const { createQuickTutorReplyWithQwen } = await import("../server/qwenTutor.mjs");
  await createQuickTutorReplyWithQwen("我看到过", { ...context, profile: { ageBand: "4-5" } }, "好的。");
  assert.ok(body, "the mocked model request must execute before checking its history");
  const history = JSON.parse(body.messages[1].content).recentMessages;
  assert.match(history, /小宇（说到这里被孩子打断）: 蜗牛背着小房子。（没说出来：它爬过的地方亮晶晶的。）/);
  assert.match(history, /小宇（刚开口就被孩子打断，孩子没听到这句；原本想说：你想不想去找找？）/);
  assert.match(history, /小宇（说到一半被孩子打断，孩子可能没听完）: 不是开头的部分。/);
  assert.match(body.messages[0].content, /标着“没说出来”的部分孩子没听到/);
});
