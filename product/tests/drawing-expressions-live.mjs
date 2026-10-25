// Six explicit, synthetic calls. No recordings, child conversations or local archives are read.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../server/env.mjs";
import { planDrawingWithQwen } from "../server/drawingPlanner.mjs";
import { createDrawingScene, applyDrawingOperations, validDrawingScene } from "../src/whiteboard/drawingScene.js";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";
if (process.env.LIVE_LLM !== "1") throw new Error("Set LIVE_LLM=1 to run six synthetic provider calls");
loadLocalEnv(fileURLToPath(new URL("../", import.meta.url)));
const make = ops => ({ type: "scene", scene: applyDrawingOperations(createDrawingScene("expression-eval"), { baseRevision: 1, operations: ops }).scene });
const add = (kind, count = 1) => ({ op: "add", kind, count });
const one = make([add("house"), { op: "update", id: "object-1", patch: { color: "#b5a0bf", scale: 0.8 } }]);
const two = make([add("house", 2)]);
const beside = make([add("house"), add("tree")]);
const cases = [
  ["照着这座小屋再画一个一样的，放在它右边", one, scene => {
    assert.equal(scene.objects.length, 2);
    assert.deepEqual(scene.objects[0], one.scene.objects[0]);
    assert.deepEqual(scene.objects[1], { ...one.scene.objects[0], id: "object-2", x: 514 });
  }],
  ["把树移到房子的右侧", beside, scene => {
    assert.deepEqual(scene.objects[0], beside.scene.objects[0]);
    assert.equal(scene.objects.find(o => o.kind === "tree").x, 514);
  }],
  ["把两个房子的屋顶都涂成蓝色", two, scene => {
    assert.equal(scene.objects.length, 2);
    for (const o of scene.objects) assert.deepEqual(o, { ...two.scene.objects.find(b => b.id === o.id), roofColor: "#87bbc9" });
  }],
  ["先画一座蓝色屋顶的小房子，然后画一个太阳，再画一棵树", { type: "blank" }, scene => {
    assert.deepEqual(scene.objects.map(o => o.kind).sort(), ["house", "sun", "tree"]);
    assert.equal(scene.objects.find(o => o.kind === "house").roofColor, "#87bbc9");
    assert.equal(scene.steps.length, 3);
    assert.deepEqual(scene.presentation.frames.map(frame => frame.length), [1, 2, 3]);
  }],
  ["把最大的房子屋顶刷成绿色", two, scene => assert.deepEqual(scene.objects, two.scene.objects)],
  ["请给房子添七扇窗户", one, scene => assert.deepEqual(scene.objects, one.scene.objects)]
];
const report = [];
for (const [input, board, verify] of cases) {
  const local = resolveIllustrationPlan(input, { board });
  assert.equal(local?.needsPlanner, true, "The real app must route this expression to the planner");
  const result = await planDrawingWithQwen({ input, board });
  const entry = { input, status: result.llmStatus, reply: result.plan?.reply, pass: false };
  try {
    assert.ok(result.plan, result.llmStatus.reason);
    assert.ok(validDrawingScene(result.plan.board.scene));
    verify(result.plan.board.scene);
    entry.pass = true;
  } catch (error) { entry.failure = error.message; }
  report.push(entry);
}
console.log(JSON.stringify(report, null, 2));
if (report.some(item => !item.pass)) process.exitCode = 1;
