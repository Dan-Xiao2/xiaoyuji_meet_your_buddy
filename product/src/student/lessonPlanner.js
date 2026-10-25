import { masteryPercent } from "./masteryModel.js";
import { createStoryLesson } from "../story/storyEngine.js";

export function planLesson(studentModel, activity, input = "") {
  if (activity === "story") {
    return createStoryLesson(input, studentModel);
  }

  if (activity === "algebra") {
    return planDistributivePropertyLesson(studentModel);
  }

  if (activity !== "math") {
    return planNonMathLesson(studentModel, activity);
  }

  const skill = studentModel.skills["math.subtract_as_takeaway"];
  const mastery = Number.isFinite(skill?.mastery) ? skill.mastery : 0.3;
  const difficulty = mastery < 0.45 ? "easy" : mastery < 0.75 ? "medium" : "challenge";
  const problem = pickSubtractionProblem(difficulty);
  const interest = pickInterest(studentModel);
  const format = studentModel.learningStyle.prefersStoryContext === false ? "direct_objects" : "story_with_objects";

  return {
    id: `lesson_${Date.now()}`,
    activity: "math",
    skill: "math.subtract_as_takeaway",
    difficulty,
    format,
    problem,
    object: interest.includes("颜色") ? "小球" : "苹果",
    awaitingAnswer: true,
    teachingMove: mastery < 0.45 ? "model_then_ask" : "ask_then_check",
    plannerReason: `当前“拿走”掌握度约 ${masteryPercent(skill)}%，先用${difficultyLabel(difficulty)}题和视觉动作。`
  };
}

export function planNextAfterResult(studentModel, previousLesson, result) {
  if (previousLesson.activity === "algebra") {
    return planNextAlgebraAfterResult(studentModel, previousLesson, result);
  }

  const skill = studentModel.skills[previousLesson.skill];
  const difficulty = result.correct && (skill?.mastery || 0) > 0.45 ? "medium" : "easy";
  const problem = result.correct ? pickSubtractionProblem(difficulty) : makeEasierProblem(previousLesson.problem);

  return {
    ...previousLesson,
    id: `lesson_${Date.now()}`,
    difficulty,
    problem,
    awaitingAnswer: true,
    teachingMove: result.correct ? "extend" : "reteach",
    plannerReason: result.correct
      ? "孩子刚刚答对，下一题稍微变化一下，观察是否真的理解。"
      : "孩子刚刚需要提示，下一题降低负担，继续用划掉动作。"
  };
}

function planDistributivePropertyLesson(studentModel) {
  const skill = studentModel.skills["algebra.distributive_property"];
  const mastery = Number.isFinite(skill?.mastery) ? skill.mastery : 0.55;
  const problem = {
    left: "3(x + 4)",
    right: 21,
    coefficient: 3,
    constant: 4,
    answer: 3,
    commonWrongAnswer: 17 / 3
  };

  return {
    id: `lesson_${Date.now()}`,
    activity: "algebra",
    skill: "algebra.distributive_property",
    difficulty: mastery < 0.6 ? "easy" : "medium",
    format: "equation_with_visual_brackets",
    problem,
    awaitingAnswer: true,
    teachingMove: "diagnose_then_visualize",
    plannerReason: `当前分配律掌握度约 ${masteryPercent(skill)}%。这题用于测试学生是否会把系数分配到括号内每一项。`
  };
}

function planNextAlgebraAfterResult(studentModel, previousLesson, result) {
  const skill = studentModel.skills[previousLesson.skill];
  const repeatedMisconception = result.errorType === "failed_distributive_property";
  const problem = repeatedMisconception
    ? {
        left: "2(x + 5)",
        right: 18,
        coefficient: 2,
        constant: 5,
        answer: 4,
        commonWrongAnswer: 13 / 2
      }
    : {
        left: "4(x + 2)",
        right: 24,
        coefficient: 4,
        constant: 2,
        answer: 4,
        commonWrongAnswer: 22 / 4
      };

  return {
    ...previousLesson,
    id: `lesson_${Date.now()}`,
    problem,
    difficulty: repeatedMisconception ? "easy" : "medium",
    awaitingAnswer: true,
    teachingMove: repeatedMisconception ? "trigger_visual_explanation" : "test_transfer",
    plannerReason: repeatedMisconception
      ? `分配律误区置信度 ${Math.round((result.confidence || 0) * 100)}%。下一题测试同一误区，并触发视觉解释。`
      : `当前分配律掌握度约 ${masteryPercent(skill)}%，下一题测试迁移。`
  };
}

function planNonMathLesson(studentModel, activity) {
  const skill = activity === "english" ? "language.full_sentence" : "language.full_sentence";
  return {
    id: `lesson_${Date.now()}`,
    activity,
    skill,
    difficulty: "easy",
    format: "short_conversation",
    awaitingAnswer: false,
    plannerReason: studentModel.profile.interests.length
      ? `先从孩子最近提到的${studentModel.profile.interests.join("、")}开始，做短轮次互动。`
      : "还没有可靠兴趣证据，先跟随孩子本轮主动提到的内容。"
  };
}

function pickSubtractionProblem(difficulty) {
  if (difficulty === "challenge") return { total: 8, takeaway: 3, answer: 5 };
  if (difficulty === "medium") return { total: 6, takeaway: 2, answer: 4 };
  return { total: 5, takeaway: 2, answer: 3 };
}

function makeEasierProblem(problem) {
  if (problem.total <= 3) return { total: 3, takeaway: 1, answer: 2 };
  return { total: 4, takeaway: 1, answer: 3 };
}

function pickInterest(studentModel) {
  return studentModel.profile.interests[0] || "苹果";
}

function difficultyLabel(difficulty) {
  if (difficulty === "challenge") return "稍有挑战的";
  if (difficulty === "medium") return "中等";
  return "低负担";
}
