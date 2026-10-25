import test from "node:test";
import assert from "node:assert/strict";
import { planDrawingWithQwen, validateDrawingPlan } from "../server/drawingPlanner.mjs";
import { createDrawingScene, applyDrawingOperations } from "../src/whiteboard/drawingScene.js";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";

const initial = () => createDrawingScene("planner-test");
const settings = t => {
  const names = ["QWEN_API_KEY", "LLM_PROVIDER", "TUTOR_ENABLE_LLM"];
  const old = names.map(n => process.env[n]);
  Object.assign(process.env, { QWEN_API_KEY: "test-only", LLM_PROVIDER: "qwen", TUTOR_ENABLE_LLM: "true" });
  t.after(() => names.forEach((n, i) => old[i] === undefined ? delete process.env[n] : process.env[n] = old[i]));
};

test("planner can compose three independent sizes with bounded operations", () => {
  const scene = initial();
  const result = validateDrawingPlan({ baseRevision: scene.revision, operations: [
    { op: "add", kind: "house", count: 3 },
    { op: "update", id: "object-1", patch: { scale: 0.7 } },
    { op: "update", id: "object-3", patch: { scale: 1.2, roofColor: "#87bbc9" } }
  ] }, scene, "画三座大小不同的房子");
  assert.deepEqual(result.scene.objects.map(o => o.scale), [0.7, 1, 1.2]);
  assert.equal(result.scene.objects[2].roofColor, "#87bbc9");
  assert.match(result.reply, /3座房子/);
});

test("unrequested destruction, stale, executable and mixed outputs are rejected", () => {
  const s = applyDrawingOperations(initial(), { baseRevision: 1, operations: [{ op: "add", kind: "house", count: 1 }] }).scene;
  for (const output of [
    { baseRevision: 1, operations: [{ op: "clear" }] },
    { baseRevision: s.revision, operations: [{ op: "clear" }] },
    { baseRevision: s.revision, operations: [{ op: "remove", id: s.objects[0].id }] },
    { baseRevision: s.revision, operations: [{ op: "execute", code: "alert(1)" }] },
    { baseRevision: s.revision, clarification: "target", operations: [{ op: "undo" }] },
    { baseRevision: s.revision, clarification: "我已经画好恐龙了" },
    { baseRevision: s.revision, reply: "fake", operations: [{ op: "undo" }] }
  ]) assert.equal(validateDrawingPlan(output, s, "把屋顶刷蓝"), null);
});

test("clarification has no mutation and no unverified model speech", () => {
  const s = initial();
  const result = validateDrawingPlan({ baseRevision: 1, clarification: "unsupported" }, s, "画恐龙");
  assert.strictEqual(result.scene, s);
  assert.equal(result.changed, false);
  assert.match(result.reply, /暂时/);
});

test("one Qwen request sends only bounded scene/context and records token usage", async t => {
  settings(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    const payload = JSON.parse(options.body), message = JSON.parse(payload.messages[1].content);
    assert.equal(payload.enable_thinking, false);
    assert.ok(message.context.length <= 4);
    assert.equal(message.scene.history, undefined);
    assert.equal(message.profile, undefined);
    assert.match(payload.messages[0].content, /只输出JSON/);
    return { ok: true, json: async () => ({ usage: { prompt_tokens: 1100, completion_tokens: 100 },
      choices: [{ message: { content: JSON.stringify({ baseRevision: message.scene.revision, operations: [
        { op: "add", kind: "house", count: 3 }, { op: "update", id: "object-1", patch: { scale: 0.7 } }
      ] }) } }] }) };
  });
  const r = await planDrawingWithQwen({ input: "画三座大小不同的房子", context: Array(10).fill({ role: "child", text: "画画" }) });
  assert.equal(calls, 1);
  assert.equal(r.plan.board.scene.objects.length, 3);
  assert.equal(r.plan.reply, r.plan.board.scene.steps[0].text);
  assert.equal(r.llmStatus.inputTokens, 1100);
  assert.equal(r.llmStatus.outputTokens, 100);
  assert.equal(r.sourceRevision, null);
});

test("provider errors, invalid JSON and bad operations return a non-destructive fallback", async t => {
  settings(t);
  for (const content of ["not JSON", JSON.stringify({ baseRevision: 1, operations: [{ op: "add", kind: "dragon", count: 1 }] })]) {
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }));
    const r = await planDrawingWithQwen({ input: "画一个大房子" });
    assert.equal(r.plan, null);
    assert.equal(r.llmStatus.fallback, true);
  }
  t.mock.method(globalThis, "fetch", async () => ({ ok: false }));
  assert.equal((await planDrawingWithQwen({ input: "画画" })).llmStatus.reason, "provider-error");
});

test("aborting while the body is loading prevents publication", async t => {
  settings(t);
  const abort = new AbortController();
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => {
    abort.abort();
    return { choices: [{ message: { content: JSON.stringify({ baseRevision: 1, operations: [{ op: "add", kind: "house", count: 1 }] }) } }] };
  } }));
  const r = await planDrawingWithQwen({ input: "画画" }, { signal: abort.signal });
  assert.equal(r.plan, null);
});

test("disabled configuration and pre-cancelled requests never call a provider", async t => {
  settings(t); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("must not fetch"); });
  process.env.TUTOR_ENABLE_LLM = "false";
  assert.equal((await planDrawingWithQwen({ input: "画画" })).plan, null);
  process.env.TUTOR_ENABLE_LLM = "true";
  assert.equal((await planDrawingWithQwen({ input: "画画" }, { signal: AbortSignal.abort() })).plan, null);
  assert.equal(calls, 0);
});

test("asking a question on an empty scene does not open an empty illustration", async t => {
  settings(t);
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({
    choices: [{ message: { content: JSON.stringify({ baseRevision: 1, clarification: "unsupported" }) } }]
  }) }));
  const r = await planDrawingWithQwen({ input: "画蝴蝶" });
  assert.equal(r.plan.board.type, "blank");
  assert.equal(r.plan.changed, false);
  const previous = resolveIllustrationPlan("画两座房子");
  const scene = previous.board.scene;
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({
    choices: [{ message: { content: JSON.stringify({ baseRevision: scene.revision, clarification: "target" }) } }]
  }) }));
  const clarified = await planDrawingWithQwen({ input: "把那个弄得更高一些", board: previous.board });
  assert.ok(clarified.plan.pending.planner);
  const followup = resolveIllustrationPlan("右边的", { board: clarified.plan.board, visualPlan: clarified.plan });
  assert.equal(followup.needsPlanner, true);
  assert.deepEqual(followup.board.scene.objects, previous.board.scene.objects);
});
