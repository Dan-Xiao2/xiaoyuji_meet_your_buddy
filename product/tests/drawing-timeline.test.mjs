import assert from "node:assert/strict";
import test from "node:test";
import { createDrawingScene, applyDrawingOperations, validDrawingScene, normalizeDrawingScene } from "../src/whiteboard/drawingScene.js";
import { attachDrawingPresentation } from "../src/whiteboard/drawingTimeline.js";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";
import { validateDrawingPlan } from "../server/drawingPlanner.mjs";

const apply = (scene, operations) => applyDrawingOperations(scene, { baseRevision: scene.revision, operations });
const initial = () => createDrawingScene("timeline-test");
const house = () => apply(initial(), [{ op: "add", kind: "house", count: 1 }]).scene;

test("prefix frames track narration; creation attributes arrive together and undo stays atomic", () => {
  const source = initial();
  const ops = [{ op: "add", kind: "house", count: 1 },
    { op: "update", id: "object-1", patch: { roofColor: "#87bbc9", scale: 0.8 } },
    { op: "add", kind: "sun", count: 1 }, { op: "add", kind: "tree", count: 1 }];
  const result = validateDrawingPlan({ baseRevision: source.revision, operations: ops }, source, "画蓝屋顶的小房子，然后画太阳和树");
  const s = result.scene;
  assert.ok(validDrawingScene(s));
  assert.equal(s.steps.length, 3);
  assert.equal(result.reply, s.steps.map(step => step.text).join(""));
  assert.deepEqual(s.presentation.initialObjects, []);
  assert.deepEqual(s.presentation.frames.map(frame => frame.length), [1, 2, 3]);
  assert.equal(s.presentation.frames[0][0].roofColor, "#87bbc9");
  assert.equal(s.presentation.frames[0][0].scale, 0.8);
  assert.equal(s.history.length, 1);
  assert.equal(s.revision, source.revision + 1);
  assert.deepEqual(apply(s, [{ op: "undo" }]).scene.objects, []);
  assert.deepEqual(source.objects, []);
});

test("duplicate preserves attributes but not ID; relative placement does not move the anchor", () => {
  let source = house();
  source = apply(source, [{ op: "update", id: "object-1", patch: { color: "#b5a0bf", scale: 0.75 } }]).scene;
  const ops = [{ op: "duplicate", id: "object-1" }, { op: "place", id: "object-2", relativeTo: "object-1", side: "right" }];
  const result = apply(source, ops);
  assert.ok(result.ok);
  assert.deepEqual(result.scene.objects[0], source.objects[0]);
  assert.deepEqual(result.scene.objects[1], { ...source.objects[0], id: "object-2", x: 514 });
  const timeline = attachDrawingPresentation(source, ops, result.scene);
  assert.equal(timeline.steps.length, 1);
  assert.equal(timeline.presentation.frames[0][1].x, 514);
});

test("relative placement rejects occupied, outside, cross-layer and same-object destinations atomically", () => {
  const source = apply(house(), [{ op: "add", kind: "tree", count: 1 }, { op: "add", kind: "sun", count: 1 }]).scene;
  for (const action of [
    { op: "place", id: "object-2", relativeTo: "object-1", side: "up" },
    { op: "place", id: "object-1", relativeTo: "object-2", side: "left" },
    { op: "place", id: "object-3", relativeTo: "object-1", side: "right" },
    { op: "place", id: "object-1", relativeTo: "object-1", side: "right" }
  ]) {
    const r = apply(source, [action]); assert.equal(r.ok, false); assert.equal(r.scene, source);
  }
  const filled = apply(source, [{ op: "add", kind: "house", count: 1 }]).scene;
  const r = apply(filled, [{ op: "place", id: "object-2", relativeTo: "object-1", side: "right" }]);
  assert.equal(r.reason, "capacity"); assert.equal(r.scene, filled);
  assert.equal(apply(filled, [{ op: "duplicate", id: "object-1" }]).reason, "capacity");
});

test("next turn clears old playback; normalization preserves validated frames and rejects corruption", () => {
  const source = house();
  const ops = [{ op: "add", kind: "sun", count: 1 }, { op: "add", kind: "cloud", count: 1 }];
  const scene = attachDrawingPresentation(source, ops, apply(source, ops).scene);
  assert.deepEqual(normalizeDrawingScene(scene), scene);
  assert.notEqual(normalizeDrawingScene(scene).presentation.frames, scene.presentation.frames);
  assert.equal(apply(scene, [{ op: "undo" }]).scene.presentation, undefined);
  for (const edit of [
    s => s.presentation.frames.pop(), s => s.presentation.frames.at(-1).pop(),
    s => s.presentation.initialObjects[0].x = -100, s => s.presentation.script = "alert(1)",
    s => s.steps[0].text = "x".repeat(121)
  ]) {
    const corrupt = structuredClone(scene); edit(corrupt);
    assert.equal(validDrawingScene(corrupt), false); assert.equal(normalizeDrawingScene(corrupt), null);
  }
});

test("long compound plans retain all spoken actions instead of silently truncating the last ones", () => {
  const source = initial();
  const ops = [{ op: "add", kind: "house", count: 3 }, ...[1, 2, 3].map(i => ({ op: "update", id: `object-${i}`,
    patch: { color: "#b5a0bf", roofColor: "#87bbc9", scale: 0.8 } })),
  { op: "add", kind: "sun", count: 1 }, { op: "add", kind: "cloud", count: 1 },
  { op: "connect", from: "object-1", to: "object-2" }, { op: "connect", from: "object-2", to: "object-3" }];
  const result = validateDrawingPlan({ baseRevision: source.revision, operations: ops }, source, "画房子和天空，再连小路");
  assert.ok(result); assert.ok(validDrawingScene(result.scene));
  assert.match(result.reply, /第2座房子和第3座房子/);
  assert.deepEqual(result.scene.presentation.frames.at(-1), result.scene.objects);
});

test("copy and relative requests reach the planner intact, without dropping a clause locally", () => {
  const state = { board: { type: "scene", scene: house() } };
  for (const text of ["照着这个再画一个一样的", "在房子右侧添一棵树", "复制这座房子", "把树放在房子旁边"]) {
    const r = resolveIllustrationPlan(text, state);
    assert.equal(r.needsPlanner, true); assert.deepEqual(r.board.scene.objects, state.board.scene.objects);
  }
});
