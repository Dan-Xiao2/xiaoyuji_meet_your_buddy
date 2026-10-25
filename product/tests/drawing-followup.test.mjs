import assert from "node:assert/strict";
import test from "node:test";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";
import { guardDrawingReply } from "../server/drawingReplyGuard.mjs";
import { createInitialState } from "../src/data/studentModel.js";
import { createQuickTutorReplyWithQwen, createTutorTurnWithQwen } from "../server/qwenTutor.mjs";

const turn = (input, state = {}) => {
  const plan = resolveIllustrationPlan(input, state);
  assert.ok(plan, input);
  return { board: plan.board, visualPlan: plan };
};

test("natural colour preference, leading ASR punctuation and acknowledgements retain the actual drawing", () => {
  let state = turn("你可以画一个房子吗？");
  const id = state.board.scene.id;
  state = turn("，我想要一个紫色顶的房子。", state);
  assert.equal(state.visualPlan.changed, true);
  assert.equal(state.board.scene.objects[0].roofColor, "#b5a0bf");
  const picture = structuredClone(state.board.scene.objects);
  for (const input of ["嗯。", "发给我看吧。", "好好。", "我怎么没有看到？", "嗯。", "嗯。", "谢谢"]) {
    state = turn(input, state);
    assert.equal(state.board.scene.id, id);
    assert.deepEqual(state.board.scene.objects, picture);
    assert.equal(state.visualPlan.needsPlanner, undefined);
    assert.doesNotMatch(state.visualPlan.reply, /门|窗|变大/);
  }
});

test("colour shorthand edits an existing object rather than inventing a new house", () => {
  for (const input of ["我要蓝顶的房子", "改成紫色", "变成绿色", "紫色", "红的"]) {
    const state = turn(input, turn("画一个房子"));
    assert.equal(state.board.scene.objects.length, 1);
    assert.equal(state.visualPlan.changed, true, input);
  }
});

test("ambiguous roof choice asks which house and does not discard pending selection on 'okay'", () => {
  let state = turn("我想要紫色顶的房子", turn("画两座房子"));
  const before = structuredClone(state.board.scene.objects);
  assert.equal(state.visualPlan.pending.candidates.length, 2);
  state = turn("好。", state);
  assert.deepEqual(state.board.scene.objects, before);
  state = turn("右边的", state);
  assert.equal(state.board.scene.objects[1].roofColor, "#b5a0bf");
  assert.equal(state.board.scene.objects[0].roofColor, "#df837a");
});

test("unsupported parts never silently resize the entire house; actual topic changes can exit", () => {
  const state = turn("画一个房子");
  for (const input of ["把门变大", "我想要会打开的门", "把左边的窗户改成紫色"]) {
    const next = turn(input, state);
    assert.equal(next.visualPlan.needsPlanner, true);
    assert.deepEqual(next.board.scene.objects, state.board.scene.objects);
  }
  for (const input of ["太阳为什么会热", "换个话题吧", "给我讲个故事", "我昨天画了一个房子"]) {
    assert.equal(resolveIllustrationPlan(input, state), null, input);
  }
});

test("ordinary model responses cannot pretend to have executed a drawing", () => {
  const state = turn("画一个房子");
  for (const reply of ["圆圆门画好啦，在房子中间。", "门变大啦，现在看得清楚了吗？", "紫色屋顶的小房子变出来啦。", "我再画大一点给你看。", "圆圆门在房子中间呀，你看。"]) {
    const result = guardDrawingReply(reply, "嗯", state);
    assert.equal(result.replaced, true, reply);
    assert.doesNotMatch(result.reply, /画好|变大/);
  }
  assert.equal(guardDrawingReply("你喜欢紫色呀。", "嗯", state).replaced, false);
  assert.equal(guardDrawingReply("小兔把画画好啦。", "讲一个画画的故事", state).replaced, false);
});

test("both model response paths enforce the execution boundary before publication", async t => {
  const keys = ["QWEN_API_KEY", "LLM_PROVIDER", "TUTOR_ENABLE_LLM"];
  const old = keys.map(key => process.env[key]);
  Object.assign(process.env, { QWEN_API_KEY: "test-only", LLM_PROVIDER: "qwen", TUTOR_ENABLE_LLM: "true" });
  t.after(() => keys.forEach((key, i) => old[i] === undefined ? delete process.env[key] : process.env[key] = old[i]));
  let full = false, calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    assert.match(JSON.parse(options.body).messages[0].content, /普通聊天回复不会执行画布操作/);
    const claim = "圆圆门画好啦，在房子中间。";
    return { ok: true, json: async () => ({ choices: [{ message: {
      content: full ? JSON.stringify({ tutorReply: claim, board: { type: "blank" } }) : claim
    } }] }) };
  });
  const state = { ...createInitialState(), ...turn("画一个房子") };
  const quick = await createQuickTutorReplyWithQwen("我还有一个想法", state);
  assert.equal(quick.llmStatus.drawingClaimFallback, true);
  assert.match(quick.reply, /还没有改动画面/);
  full = true;
  const complete = await createTutorTurnWithQwen("我还有一个想法", state);
  assert.equal(complete.llmStatus.drawingClaimFallback, true);
  assert.doesNotMatch(complete.messages.at(-1).text, /圆圆门画好/);
  assert.equal(calls, 2);
});
