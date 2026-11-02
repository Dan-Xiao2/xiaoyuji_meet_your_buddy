import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { collectConversationTurn } from "../scripts/benchmark-conversation-turn.mjs";
import { createInitialState } from "../src/data/studentModel.js";

function mockProvider(t, payloads) {
  const keys = ["QWEN_API_KEY", "QWEN_BASE_URL", "TUTOR_ENABLE_LLM", "LLM_PROVIDER"];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => saved[i] === undefined ? delete process.env[key] : process.env[key] = saved[i]));
  Object.assign(process.env, { QWEN_API_KEY: "test-key", QWEN_BASE_URL: "https://example.invalid/v1", TUTOR_ENABLE_LLM: "true", LLM_PROVIDER: "qwen" });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, body: (async function* () {
      for (const item of payloads) yield new TextEncoder().encode(`data: ${JSON.stringify(item)}\n\n`);
    })() };
  });
  return requests;
}
const delta = text => ({ choices: [{ delta: { content: text } }] });
const state = () => {
  const value = createInitialState();
  value.profile.ageBand = "4-5";
  return value;
};

test("stream benchmark captures released segments in order, context, and usage from the production generator", async t => {
  const requests = mockProvider(t, [delta("你说的是湿纸巾上的豆子，"), delta("豆子会慢慢吸水。"), { usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }]);
  const current = state();
  current.messages.push({ role: "child", text: "我在湿纸巾上种豆子。" }, { role: "tutor", text: "你给纸巾加水了吗？" }, { role: "child", text: "嗯" });
  const result = await collectConversationTurn("嗯", current, { mode: "stream" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].stream, true);
  assert.match(requests[0].messages[1].content, /湿纸巾/);
  assert.deepEqual(result.releasedSegments.map(item => item.text), ["你说的是湿纸巾上的豆子，", "豆子会慢慢吸水。"]);
  assert.equal(result.reply, "你说的是湿纸巾上的豆子，豆子会慢慢吸水。");
  assert.equal(result.firstTextMs, result.releasedSegments[0].elapsedMs);
  assert.ok(result.firstTextMs <= result.latencyMs);
  assert.equal(result.llmStatus.tokenUsage.totalTokens, 30);
});

test("a partial stream failure remains visible rather than counting as normal completion", async t => {
  mockProvider(t, [delta("你发现豆子变大了。"), { error: { message: "mock upstream failure" } }]);
  const result = await collectConversationTurn("我发现豆子变大了", state(), { mode: "stream" });
  assert.equal(result.reply, "你发现豆子变大了。");
  assert.equal(result.llmStatus.stoppedBy, "error");
  assert.match(result.llmStatus.message, /mock upstream failure/);
});

test("local controls make no provider call and retain their local status", async t => {
  const requests = mockProvider(t, []);
  const result = await collectConversationTurn("今天先聊到这里，小宇再见。", state(), { mode: "stream" });
  assert.equal(requests.length, 0);
  assert.equal(result.llmStatus.provider, "local");
  assert.match(result.reply, /再见/);
});

test("aborted collection rejects without inventing a completed reply", async t => {
  const requests = mockProvider(t, []);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(collectConversationTurn("我发现豆子", state(), { mode: "stream", signal: controller.signal }), { name: "AbortError" });
  assert.equal(requests.length, 0);
});

test("context fixture contains paired meanings and explicit human review criteria", async () => {
  const cases = JSON.parse(await readFile(new URL("../benchmarks/fixtures/conversation-context.json", import.meta.url), "utf8"));
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
  for (const item of cases) {
    assert.ok(item.humanReviewCriteria.length);
    assert.ok(item.turns.length);
    for (const message of item.seedMessages) assert.ok(["child", "tutor"].includes(message.role) && message.text);
    for (const turn of item.turns) assert.ok(turn.input);
  }
  for (const input of ["嗯", "不知道", "没有了"]) {
    assert.ok(cases.filter(item => item.turns.some(turn => turn.input === input)).length >= 2, input);
  }
});

test("CLI refuses paid execution without explicit flags before loading any credentials", () => {
  assert.throws(() => execFileSync(process.execPath, ["scripts/benchmark-real-model.mjs"], { encoding: "utf8", stdio: "pipe" }), error => /require both --live and --allow-paid-api/.test(error.stderr));
});

test("CLI stream report keeps seeded context, actual replies and text release evidence (all network mocked)", async () => {
  const preload = `globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"我听到了。"}}]}\\n\\ndata: {"usage":{"prompt_tokens":20,"completion_tokens":5,"total_tokens":25}}\\n\\n', {headers:{'Content-Type':'text/event-stream'}});`;
  const output = execFileSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, "scripts/benchmark-real-model.mjs", "--live", "--allow-paid-api", "--reply-mode=stream", "--suite=context", "--scenarios=ack-answer", "--max-text-calls=2"], {
    encoding: "utf8", env: { ...process.env, QWEN_API_KEY: "test-key", QWEN_BASE_URL: "https://example.invalid/v1", TUTOR_ENABLE_LLM: "true", LLM_PROVIDER: "qwen" }
  });
  const { report: path } = JSON.parse(output);
  try {
    const report = JSON.parse(await readFile(path, "utf8"));
    assert.equal(report.configuration.replyMode, "stream");
    assert.equal(report.configuration.suite, "context");
    assert.equal(report.summary.textApiAttempts, 2);
    assert.equal(report.conversationRows.length, 2);
    assert.equal(report.conversationRows[0].seedMessages.length, 2);
    assert.equal(report.conversationRows[1].history.filter(item => item.role === "tutor").at(-1).text, "我听到了。");
    assert.deepEqual(report.conversationRows[0].releasedSegments.map(item => item.text), ["我听到了。"]);
    assert.equal(report.humanReview.status, "required");
  } finally {
    await rm(dirname(path), { recursive: true });
  }
});
