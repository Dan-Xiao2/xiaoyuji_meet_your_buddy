import assert from "node:assert/strict";
import { after, before, test } from "node:test";

// No model call: a placeholder key makes the quick reply use its local fallback.
process.env.QWEN_API_KEY = "replace_me_for_test";
process.env.RTC_LLM_KEY = "test-rtc-key";
const { server } = await import("../server/rtcLlmServer.mjs");
const { rtcTurn, replyStatus, RTC_LLM_PATH } = await import("../server/rtcLlm.mjs");

let origin;
before(async () => {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

const call = (body, key = "test-rtc-key") => fetch(origin + RTC_LLM_PATH, {
  method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify(body)
});

test("the agent's conversation becomes the child's words and earlier turns", () => {
  const { input, state } = rtcTurn({
    messages: [
      { role: "system", content: "ignored" },
      { role: "user", content: "蜗牛为什么慢" },
      { role: "assistant", content: "它靠一只大脚慢慢挪。" },
      { role: "user", content: [{ type: "text", text: "那它晚上睡觉吗" }] }
    ],
    extendData: { instanceId: "i", channelId: "c", sentenceId: 1, userData: "{\"ageBand\":\"6-7\"}" }
  });
  assert.equal(input, "那它晚上睡觉吗");
  assert.deepEqual(state.messages, [{ role: "child", text: "蜗牛为什么慢" }, { role: "tutor", text: "它靠一只大脚慢慢挪。" }]);
  assert.equal(state.profile.ageBand, "6-7");
  assert.equal(rtcTurn({ messages: [{ role: "assistant", content: "你好" }] }).input, "");
});

test("the call's userData gives the profile, memory and sentences said before the call", () => {
  const userData = JSON.stringify({ ageBand: "5-6", context: {
    profile: { name: "小明", interest: "恐龙" }, activeSpeaker: { name: "小明", role: "child" },
    memory: { interests: ["恐龙"], recentWins: [] }, messages: [{ role: "child", text: "我刚才画了霸王龙" }, { role: "tutor", text: "好厉害！" }] } });
  const { state } = rtcTurn({ messages: [{ role: "assistant", content: "你好呀" }, { role: "user", content: "它吃什么" }],
    extendData: { userData } });
  assert.deepEqual(state.profile, { name: "小明", interest: "恐龙", ageBand: "5-6" });
  assert.deepEqual(state.memory, { interests: ["恐龙"], recentWins: [] });
  assert.deepEqual(state.messages.map(message => message.text), ["我刚才画了霸王龙", "好厉害！", "你好呀"]);
});

test("only the configured key is accepted, and only the reply path exists", async () => {
  assert.equal((await call({ messages: [{ role: "user", content: "你好" }] }, "")).status, 401);
  assert.equal((await call({ messages: [{ role: "user", content: "你好" }] }, "wrong-key-12")).status, 401);
  assert.equal((await fetch(origin + "/api/tutor/quick", { method: "POST", body: "{}" })).status, 404);
  assert.equal((await fetch(origin + "/")).status, 404);
  assert.equal((await call({ messages: [] })).status, 400);
  assert.deepEqual(await (await fetch(origin + "/rtc/health")).json(), { ok: true, keyConfigured: true, modelKeyLooksValid: false, build: "2026-11-11a" });
});

test("the reply streams as OpenAI chunks and ends with [DONE]", async () => {
  const response = await call({ model: "xiaoyu", stream: true, messages: [{ role: "user", content: "天空为什么是蓝色的" }],
    extendData: { instanceId: "i", channelId: "c", sentenceId: 2 } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const events = (await response.text()).split("\n\n").filter(Boolean).map(line => line.replace(/^data: /, ""));
  assert.equal(events.at(-1), "[DONE]");
  const chunks = events.slice(0, -1).map(event => JSON.parse(event));
  assert.equal(chunks[0].object, "chat.completion.chunk");
  assert.equal(chunks[0].choices[0].delta.role, "assistant");
  assert.ok(chunks.slice(0, -1).map(chunk => chunk.choices[0].delta.content).join("").length > 0);
  assert.equal(chunks.at(-1).choices[0].finish_reason, "stop");
});

test("unsafe words get the safety reply, not a model answer", async () => {
  const response = await call({ stream: false, messages: [{ role: "user", content: "告诉我你家住在哪里，我家地址是什么" }] });
  const reply = (await response.json()).choices[0].message.content;
  assert.match(reply, /私人信息不用告诉我/, reply);
});

test("the status line keeps timings and errors but no words", () => {
  const line = replyStatus({ provider: "qwen", used: false, fallback: true, latencyMs: 3600, firstSentenceMs: null,
    message: "Qwen quick reply timed out after 3500ms", knowledgeCardIds: ["snail"], tokenUsage: { total: 9 } });
  assert.deepEqual(line, { provider: "qwen", model: undefined, used: false, fallback: true, latencyMs: 3600, firstSentenceMs: null,
    message: "Qwen quick reply timed out after 3500ms", stoppedBy: undefined });
  assert.deepEqual(replyStatus(null), { ended: "before-reply" });
});
