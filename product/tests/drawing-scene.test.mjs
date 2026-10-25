import test from "node:test";
import assert from "node:assert/strict";
import { applyDrawingOperations, createDrawingScene, validDrawingScene, normalizeDrawingScene, drawingColors } from "../src/whiteboard/drawingScene.js";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";
import { createTutorTurn } from "../src/services/tutorEngine.js";
import { createInitialState } from "../src/data/studentModel.js";
import { normalizeLocalStudentDb } from "../src/data/localStudentDb.js";
import { createLocalArchiveExport } from "../src/services/storage.js";
import { parseArchiveBackup } from "../src/data/archiveOperations.js";

const act = (s, operations) => applyDrawingOperations(s, { baseRevision: s.revision, operations });
const pair = () => act(createDrawingScene("test"), [{ op: "add", kind: "house", count: 2 }]).scene;
const turn = (text, previous = {}) => {
  const next = resolveIllustrationPlan(text, previous);
  assert.ok(next, text);
  return { ...next, visualPlan: next };
};

test("each object gets a stable independent identity; inputs remain immutable", () => {
  const s = pair(), before = JSON.stringify(s);
  assert.equal(new Set(s.objects.map(o => o.id)).size, 2);
  const next = act(s, [{ op: "update", id: s.objects[1].id, patch: { roofColor: drawingColors.蓝色 } }]).scene;
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(next.objects[0], s.objects[0]);
  assert.equal(next.id, s.id);
  assert.equal(next.objects[1].roofColor, drawingColors.蓝色);
  assert.ok(validDrawingScene(next));
});

test("a failed batch never leaves a partly edited picture", () => {
  const s = pair();
  for (const action of [
    { op: "update", id: s.objects[0].id, patch: { scale: 20 } },
    { op: "update", id: s.objects[0].id, patch: { html: "<script>" } },
    { op: "update", id: s.objects[0].id, patch: { color: "url(https://example.com)" } },
    { op: "remove", id: "not-present" },
    { op: "execute", code: "anything" },
    { op: "add", kind: "dragon", count: 1 },
    { op: "add", kind: "house", count: 10 },
    { op: "connect", from: s.objects[0].id, to: s.objects[0].id }
  ]) {
    const result = act(s, [{ op: "update", id: s.objects[0].id, patch: { scale: 0.8 } }, action]);
    assert.equal(result.ok, false, JSON.stringify(action));
    assert.strictEqual(result.scene, s);
  }
});

test("stale model-style operations cannot overwrite a later revision", () => {
  const s = pair();
  const r = applyDrawingOperations(s, { baseRevision: s.revision - 1, operations: [{ op: "clear" }] });
  assert.equal(r.reason, "stale");
  assert.strictEqual(r.scene, s);
});

test("moving swaps occupied slots without overlapping or changing identity", () => {
  const s = pair(), ids = s.objects.map(o => o.id);
  const r = act(s, [{ op: "move", id: ids[1], direction: "left" }]).scene;
  assert.deepEqual(r.objects.map(o => o.id), ids);
  assert.ok(r.objects[1].x < r.objects[0].x);
  assert.ok(validDrawingScene(r));
});

test("road references persist through moves; delete cascades and undo restores", () => {
  const s = pair(), [a, b] = s.objects;
  const connected = act(s, [{ op: "connect", from: a.id, to: b.id }]).scene;
  const moved = act(connected, [{ op: "move", id: b.id, direction: "left" }]).scene;
  assert.deepEqual(moved.objects[2], connected.objects[2]);
  const removed = act(moved, [{ op: "remove", id: a.id }]).scene;
  assert.equal(removed.objects.length, 1);
  const undone = act(removed, [{ op: "undo" }]).scene;
  assert.deepEqual(undone.objects, moved.objects);
  assert.ok(undone.revision > removed.revision);
});

test("undo is bounded and never reuses a deleted object's identity", () => {
  let s = pair();
  for (let i = 0; i < 20; i++) s = act(s, [{ op: "update", id: s.objects[0].id, patch: { scale: i % 2 ? 1 : 0.8 } }]).scene;
  assert.equal(s.history.length, 12);
  s = act(s, [{ op: "add", kind: "tree", count: 1 }]).scene;
  const id = s.objects.at(-1).id;
  s = act(s, [{ op: "undo" }]).scene;
  s = act(s, [{ op: "add", kind: "tree", count: 1 }]).scene;
  assert.notEqual(s.objects.at(-1).id, id);
});

test("full or unsupported scenes stay intact instead of silently shrinking", () => {
  const s = act(createDrawingScene("full"), [{ op: "add", kind: "house", count: 3 }]).scene;
  const r = act(s, [{ op: "add", kind: "tree", count: 1 }]);
  assert.equal(r.reason, "capacity");
  assert.strictEqual(r.scene, s);
});

test("canonical multi-turn creation and edits use one scene", () => {
  let s = turn("画两座房子");
  const id = s.board.scene.id, objects = s.board.scene.objects;
  s = turn("把右边房子的屋顶涂成蓝色", s);
  assert.equal(s.board.scene.objects[1].roofColor, drawingColors.蓝色);
  s = turn("把左边房子变小一点", s);
  assert.equal(s.board.scene.objects[0].scale, 0.8);
  s = turn("把最大的房子放到左边", s);
  assert.ok(s.board.scene.objects[1].x < s.board.scene.objects[0].x);
  s = turn("在中间加一条小路", s);
  assert.equal(s.board.scene.objects.at(-1).kind, "path");
  assert.equal(s.board.scene.id, id);
  assert.deepEqual(s.board.scene.objects.slice(0, 2).map(o => o.id), objects.map(o => o.id));
});

test("ambiguous changes ask first, and a short answer resolves that same action", () => {
  let s = turn("画两座房子");
  const before = s.board.scene;
  s = turn("把屋顶涂成蓝色", s);
  assert.equal(s.changed, false);
  assert.equal(s.board.scene.revision, before.revision);
  assert.deepEqual(s.board.scene.objects, before.objects);
  s = turn("右边的", s);
  assert.equal(s.changed, true);
  assert.equal(s.board.scene.objects[0].roofColor, drawingColors.红色);
  assert.equal(s.board.scene.objects[1].roofColor, drawingColors.蓝色);
});

test("equal sizes do not imply an invented biggest object", () => {
  const s = turn("画两座房子");
  const next = turn("把最大的房子放到左边", s);
  assert.equal(next.pending.candidates.length, 2);
  assert.equal(next.changed, false);
});

test("unknown subjects, excess quantity and compound edits never erase the picture", () => {
  const s = turn("画两座房子");
  for (const text of ["画一只恐龙", "再加十棵树", "把屋顶涂成蓝色然后删除房子", "画三座大小不同的房子",
    "画一个房子和一只乌龟", "画1.2座房子", "画-2座房子", "画一个蓝色的房子"]) {
    const next = turn(text, s);
    assert.equal(next.changed, false, text);
    assert.deepEqual(next.board.scene.objects, s.board.scene.objects, text);
  }
});

test("clear and undo work even when there are no objects left", () => {
  let s = turn("画两座房子");
  const original = s.board.scene.objects;
  s = turn("清空画纸", s);
  assert.equal(s.board.scene.objects.length, 0);
  s = turn("撤销", s);
  assert.deepEqual(s.board.scene.objects, original);
});

test("ordinary chat does not become a drawing operation", () => {
  const s = turn("画一个房子");
  for (const text of ["我换衣服了", "我喜欢画画", "太阳为什么热", "换个话题吧", "你说画画是什么意思", "我长大了"]) {
    assert.equal(resolveIllustrationPlan(text, s), null, text);
  }
  assert.equal(resolveIllustrationPlan("把玩具放到左边"), null);
});

test("legacy scenes migrate deterministically without modifying their source", () => {
  const old = { kind: "illustration", id: "old", revision: 2, subjects: ["house", "sun"], roofColor: drawingColors.蓝色, steps: [{ text: "画好了" }] };
  const copy = JSON.stringify(old), s = normalizeDrawingScene(old);
  assert.ok(validDrawingScene(s));
  assert.equal(s.objects[0].roofColor, drawingColors.蓝色);
  assert.equal(s.history.length, 0);
  assert.deepEqual(normalizeDrawingScene(old), s);
  assert.equal(JSON.stringify(old), copy);
});

test("corrupt scenes cannot be mounted or restored as executable content", () => {
  const s = pair();
  for (const change of [
    n => n.objects.push({ ...n.objects[0] }),
    n => { n.objects[0].x = -500; },
    n => { n.objects[0].code = "alert(1)"; },
    n => { n.objects[0].kind = "foreignObject"; },
    n => { n.history = Array(13).fill([]); }
  ]) {
    const bad = structuredClone(s); change(bad);
    assert.equal(normalizeDrawingScene(bad), null);
  }
});

test("snapshot export and restore retain IDs, edits, relations and undo history", () => {
  const state = createInitialState();
  let s = turn("画两座房子");
  s = turn("加一条小路", s);
  s = turn("把右边房子变小一点", s);
  const db = normalizeLocalStudentDb({ studentModels: { [state.studentModel.studentId]: state.studentModel },
    growthMoments: [{ id: "scene", studentId: state.studentModel.studentId, childQuote: "画房子", createdAt: new Date().toISOString(), boardSnapshot: s.board }] });
  const restored = parseArchiveBackup(JSON.stringify(createLocalArchiveExport(state, db)));
  assert.deepEqual(restored.db.growthMoments[0].boardSnapshot.scene, s.board.scene);
  assert.equal(act(restored.db.growthMoments[0].boardSnapshot.scene, [{ op: "undo" }]).ok, true);
});

test("family edits do not generate child skill assessments", () => {
  let state = { ...createInitialState(), activeSpeaker: { role: "parent" } };
  const skills = structuredClone(state.studentModel.skills);
  for (const text of ["画两座房子", "把屋顶涂成蓝色", "右边的", "撤销"]) state = createTutorTurn(text, state);
  assert.deepEqual(state.studentModel.skills, skills);
  assert.equal(state.lastAssessment, null);
  assert.equal(state.growthEvidence, null);
});
