// Explicit opt-in: synthetic inputs only, at most four paid model calls, no household data.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../server/env.mjs";
import { planDrawingWithQwen } from "../server/drawingPlanner.mjs";
if (process.env.LIVE_LLM !== "1") throw new Error("Set LIVE_LLM=1 to run four synthetic provider calls");
loadLocalEnv(fileURLToPath(new URL("../", import.meta.url)));
let board = { type: "blank" };
const report = [];
for (const [input, verify] of [
  ["画三座高矮不一样的小屋", s => assert.equal(new Set(s.objects.map(o => o.scale)).size, 3)],
  ["把最矮的那座屋顶刷成蓝色", s => assert.equal([...s.objects].sort((a, b) => a.scale - b.scale)[0].roofColor, "#87bbc9")],
  ["让右边那一座更小一些", s => assert.ok(s.objects.every(o => o.scale >= 0.65 && o.scale <= 1.2))],
  ["再画一只蝴蝶在房子旁边", s => assert.equal(s.objects.some(o => o.kind === "butterfly"), false)]
]) {
  const before = board;
  const r = await planDrawingWithQwen({ input, board });
  const entry = { input, status: r.llmStatus, reply: r.plan?.reply || null };
  try {
    assert.ok(r.plan, r.llmStatus.reason);
    board = r.plan.board;
    verify(board.scene);
    if (input.includes("蝴蝶")) assert.deepEqual(board.scene.objects, before.scene.objects);
    entry.pass = true;
  } catch (e) { entry.pass = false; entry.failure = e.message; }
  report.push(entry);
}
console.log(JSON.stringify(report, null, 2));
if (report.some(r => !r.pass)) process.exitCode = 1;
