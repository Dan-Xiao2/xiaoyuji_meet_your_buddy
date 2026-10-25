import test from "node:test";
import assert from "node:assert/strict";
import { createDrawingGuard, mergeDrawingTurn, retainUpdatedDrawing, drawingContinuationBaseline } from "../src/features/drawing/drawingState.js";
import { captureEnrichmentBaseline } from "../src/session/enrichmentState.js";
import { createDrawingJob } from "../src/whiteboard/openDrawing.js";

const state = () => ({ session: { id: "test", status: "active", turnCount: 2 },
  profile: { name: "old" }, family: { activeSpeakerId: "child" },
  board: { type: "scene", scene: { id: "drawing", revision: 2 } },
  memory: { interests: [] }, studentModel: { studentId: "child" }, growthEvidence: { shouldSave: false } });

test("drawing merge preserves current family, session and concurrent parent observations", () => {
  const old = state(); const baseline = captureEnrichmentBaseline(old);
  const current = { ...old, profile: { name: "new" }, family: { activeSpeakerId: "parent" },
    session: { ...old.session, turnCount: 3 }, memory: { interests: ["parent note"] } };
  const turn = { ...old, messages: [{ role: "tutor", text: "drawing" }], growthEvidence: null };
  const merged = mergeDrawingTurn(current, turn, baseline);
  assert.equal(merged.profile, current.profile);
  assert.equal(merged.family, current.family);
  assert.equal(merged.session, current.session);
  assert.equal(merged.memory, current.memory);
  assert.equal(merged.growthEvidence, null, "old evidence can be cleared if not concurrently changed");
  assert.equal(merged.messages, turn.messages);
});

test("drawing guard ignores profile saves but detects board edits including in-place changes", () => {
  const current = state(); const guard = createDrawingGuard(); const base = guard.capture(current);
  current.profile.name = "new"; guard.observe(current.board);
  assert.equal(guard.matches(current, base), true);
  current.board.scene.revision++;
  assert.equal(guard.matches(current, base), false);
});

test("continuing chat protects routing edits without rejecting this turn's evidence reset", () => {
  const request = state(); const baseline = captureEnrichmentBaseline(request);
  const current = { ...request, studentModel: { studentId: "child", parentObservation: "new" } };
  const turn = { ...current, growthEvidence: null };
  const continued = drawingContinuationBaseline(current, turn, baseline);
  assert.equal(continued.studentModel, baseline.studentModel);
  assert.equal(continued.growthEvidence, "null");
});

test("drawing guard detects a board changed and undone back to the same model revision", () => {
  const current = state(); const guard = createDrawingGuard(); const base = guard.capture(current);
  const original = structuredClone(current.board);
  current.board.scene.revision++; guard.observe(current.board);
  current.board = original; guard.observe(current.board);
  assert.equal(guard.matches(current, base), false);
});

test("ended or replaced sessions reject old picture publication", () => {
  const current = state(); const guard = createDrawingGuard(); const base = guard.capture(current);
  assert.equal(guard.matches({ ...current, session: { id: "test", status: "ended" } }, base), false);
  assert.equal(guard.matches({ ...current, session: { id: "new", status: "active" } }, base), false);
});

test("stale drawing cannot restore its board, drawing request or success claim", () => {
  const current = { ...state(), board: { type: "image", id: "new" }, drawingRequest: null };
  const stale = { ...state(), drawingRequest: { input: "old" }, messages: [{ role: "tutor", text: "画好了" }] };
  const result = retainUpdatedDrawing(current, stale);
  assert.equal(result.board, current.board);
  assert.equal(result.drawingRequest, null);
  assert.equal(result.visualPlan.changed, false);
  assert.match(result.messages.at(-1).text, /画面.*更新/);
  assert.doesNotMatch(result.messages.at(-1).text, /画好了/);
});

for (const fail of [false, true]) test(`cancelled image ${fail ? "failure" : "success"} cannot publish`, async () => {
  const job = createDrawingJob(); let finish;
  const pending = job.run(() => new Promise((resolve, reject) => { finish = () => fail ? reject(new Error("synthetic")) : resolve("image"); }),
    () => assert.fail("late success published"), () => assert.fail("late failure published"));
  job.cancel(); finish(); await pending;
});
