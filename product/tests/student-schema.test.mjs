import test from "node:test";
import assert from "node:assert/strict";
import { createInitialStudentModel, migrateStudentModel } from "../src/student/studentSchema.js";

test("0-6 profiles start with growth evidence fields and no 7-13 algebra model", () => {
  const model = createInitialStudentModel({ name: "安安", ageBand: "4-5" });
  assert.equal(model.schemaVersion, 2);
  assert.equal(model.skills["algebra.distributive_property"], undefined);
  assert.deepEqual(model.growthProfile, {
    evidenceCount: 0,
    interestSignals: [],
    recentQuestions: [],
    familyObservations: []
  });
  assert.deepEqual(model.workArtifacts, []);
});

test("preschool migration removes the legacy algebra seed but preserves real growth fields", () => {
  const model = migrateStudentModel({
    ...createInitialStudentModel(),
    skills: { "algebra.distributive_property": { mastery: 0.8 }, "language.full_sentence": { mastery: null } },
    growthProfile: { evidenceCount: 2, recentQuestions: ["雨从哪里来？"] },
    workArtifacts: [{ id: "drawing-1" }]
  });
  assert.equal(model.skills["algebra.distributive_property"], undefined);
  assert.equal(model.growthProfile.evidenceCount, 2);
  assert.deepEqual(model.growthProfile.recentQuestions, ["雨从哪里来？"]);
  assert.deepEqual(model.workArtifacts, [{ id: "drawing-1" }]);
});
