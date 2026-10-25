export function updateSkillMastery(studentModel, skillKey, result) {
  const existing = studentModel.skills[skillKey] || {
    mastery: null,
    status: "unobserved",
    evidence: { attempts: 0, correct: 0, needsHint: 0, lastResult: "not_started" }
  };

  const delta = result.masteryDelta ?? (result.correct ? 0.09 : result.needsHint ? -0.02 : -0.05);
  const baseline = Number.isFinite(existing.mastery) ? existing.mastery : 0.25;
  const mastery = clamp(baseline + delta, 0.05, 0.98);
  const evidence = {
    attempts: existing.evidence.attempts + 1,
    correct: existing.evidence.correct + (result.correct ? 1 : 0),
    needsHint: existing.evidence.needsHint + (result.needsHint ? 1 : 0),
    lastResult: result.correct ? "correct" : result.needsHint ? "hinted" : "incorrect"
  };

  return {
    ...studentModel,
    skills: {
      ...studentModel.skills,
      [skillKey]: {
        mastery,
        status: statusFromMastery(mastery),
        evidence
      }
    }
  };
}

export function statusFromMastery(mastery) {
  if (mastery >= 0.8) return "secure";
  if (mastery >= 0.55) return "practicing";
  if (mastery >= 0.25) return "emerging";
  return "needs_support";
}

export function masteryPercent(skill) {
  return Math.round((skill?.mastery || 0) * 100);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
