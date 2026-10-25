import test from "node:test";
import assert from "node:assert/strict";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";
import { normalizeDrawingScene, validDrawingScene, applyDrawingOperations } from "../src/whiteboard/drawingScene.js";
import { validateDrawingPlan, drawingPlannerPrompt } from "../server/drawingPlanner.mjs";
import { drawingPlannerContext } from "../src/whiteboard/drawingConstraints.js";
import { compiledAssets } from "../src/whiteboard/compiledAssets.js";
import { drawingCatalog } from "../src/whiteboard/drawingCatalog.js";

const send = (input, plan) => resolveIllustrationPlan(input, plan ? { board: plan.board, visualPlan: plan } : {});
const pair = () => send("加一辆汽车", send("画一只小兔"));

test("rabbit and car share one editable scene, target-only colour and exact undo", () => {
  const p = pair(), scene = p.board.scene;
  assert.equal(p.changed, true);
  assert.deepEqual(scene.objects.map(o => o.kind), ["rabbit", "car"]);
  assert.ok(validDrawingScene(scene));
  const changed = send("汽车变蓝，兔子不要变", p);
  assert.ok(changed.changed);
  assert.deepEqual(changed.board.scene.objects[0], scene.objects[0]);
  assert.equal(changed.board.scene.objects[1].color, "#87bbc9");
  assert.deepEqual(send("撤销", changed).board.scene.objects, scene.objects);
  assert.deepEqual(normalizeDrawingScene(JSON.parse(JSON.stringify(changed.board.scene))).objects, changed.board.scene.objects);
});

test("new object quantities, capacity and unknown subjects stay bounded", () => {
  assert.equal(send("画三只兔子").board.scene.objects.length, 3);
  assert.equal(send("画两辆小汽车").board.scene.objects.length, 2);
  assert.equal(send("画四只小兔").changed, false);
  assert.equal(send("画一个屋顶").changed, false, "A roof request does not add an entire house");
  const full = send("画三只小兔");
  for (const input of ["加一辆汽车", "画一只兔子和蝴蝶", "画恐龙"]) {
    const next = send(input, full);
    assert.equal(next.changed, false);
    assert.deepEqual(next.board.scene.objects, full.board.scene.objects);
  }
});

test("protected objects cannot be moved indirectly by occupied-slot swaps", () => {
  const p = pair();
  const next = send("把汽车移到中间，兔子不要变", p);
  assert.equal(next.changed, false);
  assert.deepEqual(next.board.scene.objects, p.board.scene.objects);
  for (const phrase of ["兔子不要变", "保持兔子不变", "别动兔子", "不要改兔子"]) {
    const s = p.board.scene;
    assert.equal(validateDrawingPlan({ baseRevision: s.revision, operations: [
      { op: "move", id: s.objects[1].id, direction: "center" }
    ] }, s, `把汽车放中间，${phrase}`), null);
  }
});

test("protection is enforced during intermediate playback, not only the final state", () => {
  const s = pair().board.scene, rabbit = s.objects[0], car = s.objects[1];
  assert.equal(validateDrawingPlan({ baseRevision: s.revision, operations: [
    { op: "update", id: rabbit.id, patch: { color: "#b5a0bf" } },
    { op: "update", id: rabbit.id, patch: { color: rabbit.color } },
    { op: "update", id: car.id, patch: { color: "#87bbc9" } }
  ] }, s, "汽车变蓝，兔子不要变"), null);
  const accepted = validateDrawingPlan({ baseRevision: s.revision, operations: [
    { op: "update", id: car.id, patch: { color: "#87bbc9" } }
  ] }, s, "汽车变蓝，兔子不要变");
  assert.ok(accepted.changed);
});

test("local target clarification retains the protection on the pending action", () => {
  const p = send("再加一辆汽车", pair());
  const ambiguous = send("移到中间，兔子不要变", p);
  assert.ok(ambiguous.pending);
  assert.equal(ambiguous.changed, false);
  const confirmed = send("好的", ambiguous);
  const selected = send("左边的", confirmed);
  assert.equal(selected.changed, false);
  assert.deepEqual(selected.board.scene.objects, p.board.scene.objects);
});

test("ambiguous or unsupported protected references are not discarded", () => {
  const p = pair();
  for (const input of ["汽车变蓝，左边兔子不要变", "汽车变蓝，蝴蝶不要变"]) {
    assert.equal(send(input, p).changed, false);
    assert.equal(validateDrawingPlan({ baseRevision: p.board.scene.revision, operations: [
      { op: "update", id: p.board.scene.objects[1].id, patch: { color: "#87bbc9" } }
    ] }, p.board.scene, input), null);
  }
});

test("car windows and rabbit ears are not silently interpreted as body edits", () => {
  const p = pair(), s = p.board.scene;
  for (const input of ["把汽车车窗涂成蓝色", "把兔子耳朵变大", "车轮改成紫色"]) {
    assert.equal(send(input, p).changed, false);
    assert.equal(validateDrawingPlan({ baseRevision: s.revision, operations: [
      { op: "update", id: s.objects[1].id, patch: { color: "#87bbc9" } }
    ] }, s, input), null);
  }
  assert.equal(send("把车身涂成蓝色", p).board.scene.objects[1].color, "#87bbc9");
});

test("catalog assets are inert local paths and only designated parts are tintable", () => {
  for (const [kind, expected] of [["rabbit", 5], ["car", 8]]) {
    assert.equal(compiledAssets[kind].length, expected);
    assert.ok(drawingCatalog[kind].tintPaths.every(i => compiledAssets[kind][i]));
    for (const path of compiledAssets[kind]) {
      assert.ok(Object.keys(path).every(k => ["d", "fill", "fill-rule", "clip-rule"].includes(k)));
      assert.match(path.fill, /^(#[0-9a-f]{6}|white)$/i);
      assert.ok(!/https?:|script|url\(/.test(JSON.stringify(path)));
    }
  }
});

test("planner context shares the registry without history or family records", () => {
  const s = pair().board.scene, context = drawingPlannerContext(s, "汽车变蓝，兔子不要变");
  assert.deepEqual(context.protectedIds, [s.objects[0].id]);
  assert.ok(context.availableObjects.some(o => o.kind === "car" && o.colorPart === "车身"));
  assert.equal(context.history, undefined);
  assert.match(drawingPlannerPrompt(), /rabbit\|car/);
  const added = validateDrawingPlan({ baseRevision: s.revision, operations: [
    { op: "add", kind: "house", count: 1 }
  ] }, s, "再画一座房子");
  assert.ok(added.changed);
  assert.ok(applyDrawingOperations(added.scene, { baseRevision: added.scene.revision, operations: [{ op: "undo" }] }).ok);
});
