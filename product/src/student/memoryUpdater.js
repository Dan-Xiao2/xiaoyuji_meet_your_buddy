import { updateSkillMastery } from "./masteryModel.js";
import { classifyAnswerError } from "./errorClassifier.js";

export function evaluateAnswer(input, lesson) {
  const classified = classifyAnswerError(input, lesson);
  if (classified) {
    return {
      ...classified,
      needsHint: !classified.correct,
      masteryDelta: classified.correct ? 0.08 : classified.confidence >= 0.8 ? -0.14 : -0.06
    };
  }

  const answer = extractNumber(input);
  const expected = lesson?.problem?.answer;

  if (answer === null || expected === undefined) {
    return {
      correct: false,
      needsHint: true,
      answer,
      expected,
      observation: "孩子没有给出明确数字，可能需要更短的问题或口头选项。"
    };
  }

  return {
    correct: answer === expected,
    needsHint: answer !== expected,
    answer,
    expected,
    observation:
      answer === expected
        ? "孩子能根据视觉提示说出结果。"
        : "孩子答案和视觉结果不一致，需要继续强化“拿走后剩下”的动作。"
  };
}

export function updateStudentAfterTurn(studentModel, lesson, result) {
  let next = updateSkillMastery(studentModel, lesson.skill, result);
  next = updateSkillMastery(next, "math.answer_after_visual_prompt", {
    correct: result.correct,
    needsHint: result.needsHint
  });

  const misconceptions = updateMisconceptions(next.misconceptions, lesson.skill, result);
  const recentWins = result.correct
    ? [`能完成 ${lesson.problem.total} 个里面拿走 ${lesson.problem.takeaway} 个的题目`, ...next.engagement.recentWins]
    : ["愿意尝试回答减法问题", ...next.engagement.recentWins];

  return {
    ...next,
    misconceptions,
    engagement: {
      ...next.engagement,
      sessionCount: next.engagement.sessionCount + 1,
      recentWins: recentWins.slice(0, 5)
    }
  };
}

export function syncLegacyMemory(memory, studentModel) {
  const numberSkill = studentModel.skills["math.subtract_as_takeaway"];
  const expressionSkill = studentModel.skills["language.full_sentence"];
  return {
    ...memory,
    mastery: {
      ...(memory.mastery || {}),
      ...(Number.isFinite(numberSkill?.mastery) ? { numberSense: Math.round(numberSkill.mastery * 100) } : {}),
      ...(Number.isFinite(expressionSkill?.mastery) ? { expression: Math.round(expressionSkill.mastery * 100) } : {})
    },
    misconceptions: studentModel.misconceptions.map((item) => item.pattern),
    interests: studentModel.profile.interests,
    recentWins: studentModel.engagement.recentWins,
    sessionCount: studentModel.engagement.sessionCount
  };
}

function updateMisconceptions(misconceptions, skill, result) {
  if (result.correct) return misconceptions;

  if (result.misconception) {
    const existing = misconceptions.find((item) => item.id === result.misconception.id);
    const rest = misconceptions.filter((item) => item.id !== result.misconception.id);

    return [
      {
        id: result.misconception.id,
        skill: result.misconception.skill,
        pattern: result.misconception.pattern,
        evidence: result.misconception.evidence,
        evidenceCount: (existing?.evidenceCount || 0) + 1,
        confidence: Math.max(existing?.confidence || 0, result.confidence || 0.5),
        lastSeenAt: new Date().toISOString()
      },
      ...rest
    ].slice(0, 6);
  }

  const targetId = "subtraction_takeaway_remaining";
  const existing = misconceptions.find((item) => item.id === targetId);
  const rest = misconceptions.filter((item) => item.id !== targetId);

  return [
    {
      id: targetId,
      skill,
      pattern: "对“拿走以后剩下多少”还不稳定，可能需要继续用实物和划掉动作。",
      evidenceCount: (existing?.evidenceCount || 0) + 1,
      lastSeenAt: new Date().toISOString()
    },
    ...rest
  ].slice(0, 4);
}

function extractNumber(input) {
  const digit = input.match(/\d+/);
  if (digit) return Number(digit[0]);

  const zhNumbers = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };

  for (const [word, value] of Object.entries(zhNumbers)) {
    if (input.includes(word)) return value;
  }

  return null;
}
