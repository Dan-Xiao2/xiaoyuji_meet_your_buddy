export function classifyAnswerError(input, lesson) {
  if (lesson?.activity === "algebra" && lesson?.skill === "algebra.distributive_property") {
    return classifyDistributivePropertyError(input, lesson);
  }

  return null;
}

function classifyDistributivePropertyError(input, lesson) {
  const normalized = normalizeMathText(input);
  const expectedX = lesson.problem.answer;
  const answer = extractXAnswer(normalized);

  if (answer === expectedX) {
    return {
      correct: true,
      answer,
      expected: expectedX,
      confidence: 0.9,
      errorType: null,
      misconception: null,
      inferredWork: null,
      observation: "学生给出了正确的 x 值。"
    };
  }

  if (answer === lesson.problem.commonWrongAnswer) {
    return {
      correct: false,
      answer,
      expected: expectedX,
      confidence: 0.86,
      errorType: "failed_distributive_property",
      misconception: {
        id: "failed_distributive_property_constant",
        skill: "algebra.distributive_property",
        pattern: "只把系数乘到变量，没有乘到括号里的常数项。",
        evidence: `Likely expanded ${lesson.problem.left} as ${lesson.problem.coefficient}x + ${lesson.problem.constant}.`
      },
      inferredWork: `${lesson.problem.coefficient}x + ${lesson.problem.constant} = ${lesson.problem.right}`,
      observation: "答案高度符合“3(x+4) 被展开成 3x+4”的错误路径。"
    };
  }

  if (normalized.includes(`${lesson.problem.coefficient}x+${lesson.problem.constant}`)) {
    return {
      correct: false,
      answer,
      expected: expectedX,
      confidence: 0.92,
      errorType: "failed_distributive_property",
      misconception: {
        id: "failed_distributive_property_constant",
        skill: "algebra.distributive_property",
        pattern: "只把系数乘到变量，没有乘到括号里的常数项。",
        evidence: `Student explicitly wrote ${lesson.problem.coefficient}x + ${lesson.problem.constant}.`
      },
      inferredWork: `${lesson.problem.coefficient}x + ${lesson.problem.constant} = ${lesson.problem.right}`,
      observation: "学生明确写出了错误展开式，分配律误区置信度很高。"
    };
  }

  return {
    correct: false,
    answer,
    expected: expectedX,
    confidence: answer === null ? 0.35 : 0.55,
    errorType: answer === null ? "unparseable_answer" : "unknown_algebra_error",
    misconception: null,
    inferredWork: null,
    observation: answer === null ? "没有识别到明确的 x 值。" : "答案错误，但暂时不能稳定归因到某一个误区。"
  };
}

function normalizeMathText(input) {
  return input
    .toLowerCase()
    .replaceAll(" ", "")
    .replaceAll("×", "*")
    .replaceAll("（", "(")
    .replaceAll("）", ")")
    .replaceAll("＝", "=");
}

function extractXAnswer(normalized) {
  const explicit = normalized.match(/x=(-?\d+(?:\.\d+)?)/);
  if (explicit) return Number(explicit[1]);

  const bareNumber = normalized.match(/^-?\d+(?:\.\d+)?$/);
  if (bareNumber) return Number(bareNumber[0]);

  return null;
}
