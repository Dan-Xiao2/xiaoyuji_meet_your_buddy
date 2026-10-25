import test from "node:test";
import assert from "node:assert/strict";
import { resolveVisualPlan, relevantBoard, validBlockScene } from "../src/whiteboard/visualPlan.js";
import { createTutorTurn } from "../src/services/tutorEngine.js";
import { createInitialState } from "../src/data/studentModel.js";
import { normalizeLocalStudentDb } from "../src/data/localStudentDb.js";
import { createLocalArchiveExport } from "../src/services/storage.js";
import { parseArchiveBackup } from "../src/data/archiveOperations.js";
import { resolveIllustrationPlan, validIllustrationScene } from "../src/whiteboard/illustrationPlan.js";
import { classifyActivity } from "../src/services/tutorEngine.js";
import { createTutorTurnWithQwen, createQuickTutorReplyWithQwen } from "../server/qwenTutor.mjs";
import { solarContext, guardScienceReply } from "../server/scienceContext.mjs";

const first = () => resolveVisualPlan("我有五块积木，给爸爸两块", { session: { id: "test" } });
test("one plan supplies spoken steps and exact object quantities", () => {
  const plan = first();
  assert.ok(validBlockScene(plan.board));
  assert.deepEqual(plan.segments.map(step => step.given), [0, 2]);
  assert.equal(plan.board.scene.total, 5);
  assert.equal(plan.reply, plan.segments.map(step => step.text).join(""));
});
test("followups preserve object identity and change only the requested quantity", () => {
  const before = first();
  const more = resolveVisualPlan("再给爸爸一块", before);
  assert.equal(more.board.scene.id, before.board.scene.id);
  assert.equal(more.board.scene.revision, before.board.scene.revision + 1);
  assert.equal(more.board.scene.fromGiven, 2);
  assert.equal(more.board.scene.given, 3);
  const back = resolveVisualPlan("拿回一块", more);
  assert.equal(back.board.scene.given, 2);
  assert.equal(back.board.scene.total, 5);
  assert.equal(resolveVisualPlan("再给一块", before).board.scene.given, 3);
  assert.equal(resolveVisualPlan("我有五块积木，给了爸爸两块").board.scene.given, 2);
});
test("quantity answers do not invent mastery or diagnoses", () => {
  const state = createInitialState();
  const initial = createTutorTurn("我有五块积木，给爸爸两块", state);
  const answer = createTutorTurn("三块", initial);
  assert.equal(answer.visualPlan.segments.length, 1);
  assert.equal(answer.lastAssessment, null);
  assert.equal(answer.growthEvidence, null);
  assert.deepEqual(answer.studentModel.skills, initial.studentModel.skills);
});
test("new topics and story requests do not reuse the blocks scene", () => {
  for (const text of ["那恐龙呢", "今天交了新朋友", "如果月亮掉下来呢", "我觉得妈妈很开心", "不要积木", "讲积木的故事"]) {
    assert.equal(resolveVisualPlan(text, first()), null, text);
  }
});
test("out-of-range, negative, fractional and impossible quantities never become default pictures", () => {
  for (const text of ["我有二十块积木", "我有11块积木", "我有0块积木", "我有-5块积木", "我有2.5块积木", "我有负五块积木", "我有五块积木，给爸爸二十块", "我有五块积木，给爸爸六块"]) {
    assert.equal(resolveVisualPlan(text).board.type, "blank", text);
  }
  assert.equal(resolveVisualPlan("拿回三块", first()).board.type, "blank");
  assert.equal(resolveVisualPlan("再给妈妈一块", first()).board.type, "blank");
});
test("both boundary counts and replay remain valid", () => {
  for (const n of [1, 10]) assert.ok(validBlockScene(resolveVisualPlan(`我有${n}块积木`).board));
  const replay = resolveVisualPlan("重来", first());
  assert.equal(replay.board.scene.fromGiven, 0);
  assert.equal(replay.board.scene.given, 2);
});
test("adult input is not silently converted into a child's counting activity", () => {
  assert.equal(resolveVisualPlan("我有五块积木", { activeSpeaker: { role: "parent" } }), null);
});
test("safety responses clear any previous playable plan", () => {
  const initial = createTutorTurn("我有五块积木", createInitialState());
  const next = createTutorTurn("我住在哪里", initial);
  assert.equal(next.board.type, "safety");
  assert.equal(next.visualPlan, null);
});
test("unsupported science, routine chat and unrelated objects stay blank", () => {
  assert.equal(relevantBoard({ type: "science", items: ["太阳", "地球", "月亮"] }, "为什么下雨").type, "blank");
  assert.equal(relevantBoard({ type: "science", variant: "moon" }, "月亮为什么变样").type, "blank");
  assert.equal(relevantBoard({ type: "math", items: ["苹果"] }, "给我一块饼干").type, "blank");
  assert.equal(relevantBoard({ type: "story" }, "今天交了一个朋友").type, "blank");
  assert.equal(relevantBoard({ type: "language" }, "你好").type, "blank");
});
test("malformed scene commands cannot reach the renderer", () => {
  for (const scene of [{ ...first().board.scene, total: 200 }, { ...first().board.scene, steps: [{given: 99, text: "bad"}] }]) {
    assert.equal(relevantBoard({ type: "scene", scene }, "积木").type, "blank");
  }
});
test("local records and backup restore preserve a validated scene snapshot", () => {
  const state = createInitialState();
  const board = first().board;
  const db = normalizeLocalStudentDb({
    studentModels: { [state.studentModel.studentId]: state.studentModel },
    growthMoments: [{ id: "blocks-record", studentId: state.studentModel.studentId,
      childQuote: "我有五块积木，给爸爸两块", tutorResponse: first().reply,
      createdAt: new Date().toISOString(), boardSnapshot: board }]
  });
  assert.deepEqual(db.growthMoments[0].boardSnapshot.scene, board.scene);
  const restored = parseArchiveBackup(JSON.stringify(createLocalArchiveExport(state, db)));
  assert.deepEqual(restored.db.growthMoments[0].boardSnapshot.scene, board.scene);
});

test("explicit house requests draw; added sun retains the house and scene", () => {
  for (const input of ["画一个房子", "给我画一栋房子", "你能画一个房子吗"]) {
    const plan = resolveVisualPlan(input);
    assert.ok(validIllustrationScene(plan.board), input);
    assert.deepEqual(plan.board.scene.subjects, ["house"]);
  }
  const house = resolveVisualPlan("画一个房子");
  const sun = resolveVisualPlan("再加一个太阳", house);
  assert.deepEqual(sun.board.scene.subjects, ["house", "sun"]);
  assert.equal(sun.board.scene.id, house.board.scene.id);
  const blue = resolveVisualPlan("把屋顶涂成蓝色", sun);
  assert.equal(blue.board.scene.roofColor, "#87bbc9");
  assert.deepEqual(blue.board.scene.subjects, ["house", "sun"]);
});
test("sharing about drawing and scientific followups do not become drawing commands", () => {
  for (const text of ["我喜欢画画", "我想画画", "我画了一个房子", "太阳为什么发光", "太阳几岁了", "教我画房子"]) {
    assert.equal(resolveIllustrationPlan(text), null, text);
  }
  assert.equal(classifyActivity("太阳几岁了"), "science");
  assert.equal(classifyActivity("太阳加热空气吗"), "science");
});
test("unknown requested objects are not silently substituted with houses or blocks", () => {
  const plan = resolveVisualPlan("画一只恐龙");
  assert.equal(plan.board.type, "blank");
  assert.equal(plan.needsPlanner, true);
  assert.doesNotMatch(plan.reply, /画好|积木|不会画画/);
});
test("adult drawing requests work without changing a child's skills", () => {
  const initial = createInitialState();
  const next = createTutorTurn("画一个房子", { ...initial, activeSpeaker: { role: "parent" } });
  assert.ok(validIllustrationScene(next.board));
  assert.deepEqual(next.studentModel.skills, initial.studentModel.skills);
  assert.equal(next.growthEvidence, null);
});
test("a new question exits a stale exercise instead of being assessed", () => {
  const initial = createTutorTurn("我想玩加法", createInitialState());
  const next = createTutorTurn("太阳几岁了", initial);
  assert.equal(next.lastAssessment, null);
  assert.equal(next.activeLesson.activity, "science");
  assert.deepEqual(next.studentModel.skills, initial.studentModel.skills);
});
test("illustration snapshots survive local backup and restore", () => {
  const state = createInitialState();
  const board = resolveVisualPlan("画一个房子").board;
  const db = normalizeLocalStudentDb({ studentModels: { [state.studentModel.studentId]: state.studentModel },
    growthMoments: [{ id: "drawing", studentId: state.studentModel.studentId, childQuote: "画一个房子",
      boardSnapshot: board, createdAt: new Date().toISOString() }] });
  const restored = parseArchiveBackup(JSON.stringify(createLocalArchiveExport(state, db)));
  assert.deepEqual(restored.db.growthMoments[0].boardSnapshot.scene, board.scene);
});
test("quick and full prompts share capabilities and never inject fallback activity titles", async t => {
  const keys = ["QWEN_API_KEY", "LLM_PROVIDER", "TUTOR_ENABLE_LLM"];
  const saved = keys.map(key => process.env[key]);
  Object.assign(process.env, { QWEN_API_KEY: "test-only", LLM_PROVIDER: "qwen", TUTOR_ENABLE_LLM: "true" });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const request = JSON.parse(options.body); requests.push(request);
    const content = request.response_format ? JSON.stringify({ tutorReply: "太阳会发出光和热。", board: { type: "blank" } }) : "太阳会发出光和热。";
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  });
  try {
    const state = createTutorTurn("我想玩加法", createInitialState());
    state.messages = [{ role: "child", text: "太阳为什么会发光" }, { role: "tutor", text: "太阳会发出光和热。" }];
    await createQuickTutorReplyWithQwen("那它有多热", state);
    await createTutorTurnWithQwen("那它有多热", state);
    assert.equal(requests.length, 2, "A stale exercise must not disable Qwen for a new question");
    for (const request of requests) {
      assert.match(request.messages[0].content, /白板/);
      assert.match(request.messages[0].content, /跟随本轮话题/);
      assert.doesNotMatch(request.messages[1].content, /localFallbackPlan|一句话搭积木/);
    }
    requests.length = 0;
    const house = await createTutorTurnWithQwen("画一个房子", state);
    const quick = await createQuickTutorReplyWithQwen("画一个房子", state);
    assert.ok(validIllustrationScene(house.board));
    assert.equal(quick.reply, house.visualPlan.reply);
    assert.equal(requests.length, 0, "Supported drawings cannot be rejected by a text-only model");
  } finally {
    keys.forEach((key, i) => saved[i] === undefined ? delete process.env[key] : process.env[key] = saved[i]);
  }
});
test("solar factual context follows user questions but not unrelated model history", () => {
  const state = { messages: [{role: "child", text: "太阳为什么热"}, {role: "tutor", text: "来玩积木吧"}] };
  assert.equal(solarContext("那它会不会熄灭", state), true);
  assert.equal(solarContext("那月亮呢", state), false);
  assert.equal(solarContext("那它呢", { messages: [{role: "tutor", text: "太阳"}] }), false);
});
test("known fabricated mechanisms and unsafe solar invitations are not published", () => {
  for (const reply of ["太阳里面有小星星", "太阳靠摩擦生热", "你想摸摸太阳吗", "我们去看看太阳吧"]) {
    const checked = guardScienceReply(reply, "太阳为什么发光", {});
    assert.equal(checked.replaced, true);
    assert.doesNotMatch(checked.reply, /小星星|摩擦/);
  }
  assert.equal(guardScienceReply("我们去看看画好的房子吧", "房子", {}).replaced, false);
});
