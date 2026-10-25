import assert from "node:assert/strict";
import test from "node:test";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";
import { applyDrawingOperations, normalizeDrawingScene, validDrawingScene } from "../src/whiteboard/drawingScene.js";
import { validateDrawingPlan, drawingPlannerPrompt } from "../server/drawingPlanner.mjs";

const turn = (text, state = {}) => {
  const plan = resolveIllustrationPlan(text, state);
  assert.ok(plan, text);
  return { board: plan.board, visualPlan: plan };
};
const apply = (s, operations) => applyDrawingOperations(s, { baseRevision: s.revision, operations });

test("a child's house evolves across count, shape, colour, confirmation and undo", () => {
  let state = turn("画一个房子");
  const original = structuredClone(state.board.scene.objects[0]);
  for (const [input, key, value] of [
    ["再加一扇窗户", "windowCount", 3],
    ["把窗户改成圆形", "windowShape", "round"],
    ["把窗户涂成紫色", "windowColor", "#b5a0bf"],
    ["把门改成长方形", "doorShape", "rect"],
    ["把门换成蓝色", "doorColor", "#87bbc9"],
    ["我想要圆圆的门", "doorShape", "arched"]
  ]) {
    state = turn(input, state);
    assert.equal(state.visualPlan.needsPlanner, undefined, input);
    assert.equal(state.visualPlan.changed, true, input);
    const o = state.board.scene.objects[0];
    assert.equal(o[key], value, input);
    for (const prop of ["id", "scale", "roofColor", "color", "x", "y"]) assert.equal(o[prop], original[prop]);
  }
  const before = structuredClone(state.board.scene);
  state = turn("嗯", state);
  assert.deepEqual(state.board.scene.objects, before.objects);
  state = turn("去掉一扇窗户", state);
  assert.equal(state.board.scene.objects[0].windowCount, 2);
  state = turn("撤销", state);
  assert.deepEqual(state.board.scene.objects, before.objects);
});

test("ambiguous house details retain the pending operation until a target is selected", () => {
  let state = turn("把窗户改成圆形", turn("画两座房子"));
  const before = structuredClone(state.board.scene.objects);
  assert.equal(state.visualPlan.pending.candidates.length, 2);
  state = turn("好", state);
  state = turn("右边的", state);
  assert.deepEqual(state.board.scene.objects[0], before[0]);
  assert.equal(state.board.scene.objects[1].windowShape, "round");
  state = turn("给左边房子加一扇窗户", state);
  assert.equal(state.board.scene.objects[0].windowCount, 3);
  assert.equal(state.board.scene.objects[1].windowCount, undefined);
});

test("short colour and shape followups retain the edited part, not the entire house", () => {
  let state = turn("把右边房子的门改成长方形", turn("画两座房子"));
  state = turn("嗯", state);
  state = turn("改成紫色", state);
  assert.equal(state.board.scene.objects[1].doorColor, "#b5a0bf");
  assert.equal(state.board.scene.objects[1].color, "#efc76e");
  state = turn("圆圆的", state);
  assert.equal(state.board.scene.objects[1].doorShape, "arched");
  state = turn("把左边房子的窗户改成圆形", state);
  state = turn("给我看看", state);
  state = turn("蓝色", state);
  assert.equal(state.board.scene.objects[0].windowColor, "#87bbc9");
  assert.equal(state.board.scene.objects[1].windowColor, undefined);
});

test("unsupported qualifiers and quantities preserve the entire picture", () => {
  const source = turn("画一个房子");
  for (const text of ["加七扇窗户", "加三扇窗户", "把窗户变大一点", "给门加星星", "把左边的窗户涂蓝色", "把窗户改成三角形", "把门和窗户涂蓝色", "把蓝色房子的门涂红色"]) {
    const next = turn(text, source);
    assert.deepEqual(next.board.scene.objects, source.board.scene.objects, text);
    assert.equal(next.visualPlan.changed, false, text);
  }
  let state = turn("不要窗户", source);
  assert.equal(state.board.scene.objects[0].windowCount, 0);
  state = turn("再加一扇窗户", state);
  assert.equal(state.board.scene.objects[0].windowCount, 1);
  state = turn("改成四扇窗户", state);
  assert.equal(state.board.scene.objects[0].windowCount, 4);
});

test("old snapshots keep their shape; details survive JSON, history, duplication and undo", () => {
  const old = turn("画一个房子").board.scene;
  assert.equal(old.objects[0].windowCount, undefined);
  assert.deepEqual(normalizeDrawingScene(old), old);
  const detailed = turn("改成四扇圆形窗户", { board: { type: "scene", scene: old } }).board.scene;
  const copy = apply(detailed, [{ op: "duplicate", id: "object-1" }]).scene;
  assert.equal(copy.objects[1].windowCount, 4);
  assert.equal(copy.objects[1].windowShape, "round");
  assert.deepEqual(normalizeDrawingScene(JSON.parse(JSON.stringify(copy))), copy);
  const undo = apply(copy, [{ op: "undo" }]).scene;
  assert.deepEqual(undo.objects, detailed.objects);
  assert.deepEqual(apply(undo, [{ op: "undo" }]).scene.objects, old.objects);
});

test("invalid detail fields, unsupported objects and corrupt history are rejected atomically", () => {
  const source = turn("画房子和太阳").board.scene;
  for (const patch of [{ windowCount: 5 }, { windowCount: -1 }, { windowCount: 1.5 }, { windowCount: "2" },
    { doorShape: "circle" }, { windowShape: "triangle" }, { doorColor: "url(x)" }, { windowColor: "#fff" }, { doorScale: 2 }]) {
    const r = apply(source, [{ op: "update", id: "object-1", patch: { roofColor: "#87bbc9" } }, { op: "update", id: "object-1", patch }]);
    assert.equal(r.ok, false); assert.equal(r.scene, source);
  }
  assert.equal(apply(source, [{ op: "update", id: "object-2", patch: { windowCount: 2 } }]).ok, false);
  for (const operations of [[{ op: "remove", id: "object-1" }], [{ op: "update", id: "object-1", patch: { scale: 1.2 } }]]) {
    assert.equal(validateDrawingPlan({ baseRevision: source.revision, operations }, source, "去掉门，再把窗户变大"), null);
  }
  const corrupt = structuredClone(source);
  corrupt.history = [[{ ...source.objects[0], windowCount: 10 }]];
  assert.equal(validDrawingScene(corrupt), false);
});

test("planner details generate truthful staged narration and one undo entry", () => {
  const s = turn("画一个房子").board.scene;
  const operations = [{ op: "update", id: "object-1", patch: { windowCount: 4, windowShape: "round" } },
    { op: "update", id: "object-1", patch: { doorShape: "rect", doorColor: "#87bbc9" } }];
  const r = validateDrawingPlan({ baseRevision: s.revision, operations }, s, "先画四扇圆窗，然后改蓝色方门");
  assert.ok(r); assert.ok(validDrawingScene(r.scene));
  assert.equal(r.scene.steps.length, 2);
  assert.match(r.scene.steps[0].text, /圆形.*4扇/);
  assert.match(r.scene.steps[1].text, /长方形.*蓝色/);
  assert.equal(r.scene.presentation.frames[0][0].doorColor, undefined);
  assert.equal(r.scene.presentation.frames[1][0].doorColor, "#87bbc9");
  assert.deepEqual(apply(r.scene, [{ op: "undo" }]).scene.objects, s.objects);
  assert.match(drawingPlannerPrompt(), /windowCount:0到4/);
});
