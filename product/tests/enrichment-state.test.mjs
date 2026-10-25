import test from "node:test";
import assert from "node:assert/strict";
import { mergeEnrichmentState } from "../src/session/enrichmentState.js";

test("background enrichment only changes its owned fields", () => {
  const current = {
    profile: { name: "安安" }, family: { activeSpeakerId: "parent" }, session: { id: "session-1" },
    messages: [{ role: "tutor", text: "已经说出的回答" }], board: { type: "blank" },
    memory: { interests: [] }, studentModel: { studentId: "child-1" }, growthEvidence: null,
    activeLesson: null, offlineTask: null, drawingRequest: { input: "画房子" },
    llmStatus: { quickLatencyMs: 120 }
  };
  const enriched = {
    profile: { name: "被覆盖" }, family: { activeSpeakerId: "stranger" }, session: { id: "wrong" },
    messages: [{ role: "tutor", text: "补全内容" }], board: { type: "scene" },
    memory: { interests: ["房子"] }, studentModel: { studentId: "child-1", updated: true },
    growthEvidence: { shouldSave: true }, activeLesson: { activity: "random" },
    offlineTask: { title: "random" }, drawingRequest: null, llmStatus: { provider: "qwen" }
  };

  const result = mergeEnrichmentState(current, enriched);
  assert.equal(result.profile, current.profile);
  assert.equal(result.family, current.family);
  assert.equal(result.session, current.session);
  assert.equal(result.activeLesson, null);
  assert.equal(result.offlineTask, null);
  assert.equal(result.drawingRequest, current.drawingRequest);
  assert.equal(result.board, current.board);
  assert.equal(result.messages, current.messages);
  assert.equal(result.memory, enriched.memory);
  assert.deepEqual(result.llmStatus, { quickLatencyMs: 120, provider: "qwen" });
});

test("invalid enrichment leaves current state untouched", () => {
  const current = { session: { id: "session-1" } };
  assert.equal(mergeEnrichmentState(current, null), current);
});
