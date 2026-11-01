import { activityTypes } from "../data/activities.js";
import { checkChildSafety, createSafetyTurn, safeConversationMessages } from "./safety.js";
import { ensureStudentModel } from "../student/studentSchema.js";
import { evaluateAnswer, syncLegacyMemory, updateStudentAfterTurn } from "../student/memoryUpdater.js";
import { planLesson, planNextAfterResult } from "../student/lessonPlanner.js";
import { chooseOfflineActivity } from "../offline/offlineActivityLibrary.js";
import { continueStoryLesson } from "../story/storyEngine.js";
import { adaptTutorReply } from "../content/ageAdaptation.js";
import { resolveVisualPlan } from "../whiteboard/visualPlan.js";
import { isLessonAnswer, conversationControlReply } from "./conversationIntent.js";

export function createConversationTurn(input, currentState, options = {}) {
  return createTutorTurn(input, currentState, { ...options, freeConversation: true });
}

export function createTutorTurn(input, currentState, { freeConversation = false, onStudentEvent = () => {} } = {}) {
  const studentModel = ensureStudentModel(currentState);
  const safety = checkChildSafety(input, currentState);
  if (!safety.ok) {
    return createSafetyTurn({ ...currentState, studentModel }, safety, input);
  }

  currentState = { ...currentState, messages: safeConversationMessages(currentState.messages), safetyDecision: null, safetyContext: null };

  const controlReply = conversationControlReply(input);
  if (controlReply) return {
    ...currentState, studentModel, activeLesson: null, lastAssessment: null, offlineTask: null,
    visualPlan: { changed: false, reply: controlReply, board: currentState.board },
    growthEvidence: { shouldSave: false, sourceQuote: input, topics: [], observation: "", inference: "" },
    messages: [...withoutThinkingMessage(currentState.messages), { role: "tutor", text: controlReply }]
  };

  const visualPlan = resolveVisualPlan(input, currentState);
  if (visualPlan) return {
    ...currentState, studentModel, visualPlan, board: visualPlan.board,
    messages: [...withoutThinkingMessage(currentState.messages), { role: "tutor", text: visualPlan.reply }],
    activeLesson: null, lastAssessment: null, growthEvidence: null,
    llmStatus: { provider: "local", used: false, fallback: false, message: "白板与回应共用同一计划" }
  };
  if (currentState.activeSpeaker?.role && currentState.activeSpeaker.role !== "child") {
    return handleFamilyObservation(input, currentState, studentModel);
  }
  currentState = { ...currentState, visualPlan: null };
  if (freeConversation && !isLessonAnswer(input, currentState.activeLesson) &&
      !/^(?:请|我想|我要|帮我|教我|我们)?(?:练习|练一练|学一下|学习|教我|数一数|数数|做一道)/.test(input)) {
    return {
      ...currentState, studentModel, activeLesson: null, lastAssessment: null, offlineTask: null,
      board: currentState.board || { type: "blank" },
      growthEvidence: { shouldSave: false },
      messages: [...withoutThinkingMessage(currentState.messages), { role: "tutor", text: "这次回答没连上，可以再试一次。" }]
    };
  }
  if (isLessonAnswer(input, currentState.activeLesson)) {
    return handleStudentAnswer(input, currentState, studentModel, onStudentEvent);
  }

  if (currentState.activeLesson?.activity === "story" && /(选|门|红色|蓝色|绿色|继续)/.test(input)) {
    return handleStoryChoice(input, currentState, studentModel, onStudentEvent);
  }

  const activity = classifyActivity(input);
  const activeLesson = planLesson(studentModel, activity, input);
  onStudentEvent(studentModel.studentId, "lesson_started", {
    activity,
    skill: activeLesson.skill,
    difficulty: activeLesson.difficulty,
    plannerReason: activeLesson.plannerReason
  });

  const board = createBoard(input, activity, currentState.profile, activeLesson);
  const tutorText = adaptTutorReply(
    createTutorMessage(input, activity, currentState.profile, studentModel, activeLesson),
    currentState.profile?.ageBand
  );
  const memory = updateStudentMemory(currentState.memory, activity, input, studentModel);

  return {
    ...currentState,
    messages: [...withoutThinkingMessage(currentState.messages), { role: "tutor", text: tutorText }],
    board,
    memory,
    studentModel,
    activeLesson,
    lastAssessment: null,
    offlineTask:
      ["story", "science", "language"].includes(activity)
        ? chooseOfflineActivity({
            studentModel,
            activeLesson,
            lastAssessment: null
          })
        : currentState.offlineTask
  };
}

function handleStudentAnswer(input, currentState, studentModel, onStudentEvent) {
  const result = evaluateAnswer(input, currentState.activeLesson);
  const updatedStudentModel = updateStudentAfterTurn(studentModel, currentState.activeLesson, result);
  onStudentEvent(updatedStudentModel.studentId, "student_answered", {
    lessonId: currentState.activeLesson.id,
    skill: currentState.activeLesson.skill,
    answer: result.answer,
    expected: result.expected,
    correct: result.correct,
    needsHint: result.needsHint,
    observation: result.observation
  });

  const nextLesson = planNextAfterResult(updatedStudentModel, currentState.activeLesson, result);
  const lastAssessment = {
    skill: currentState.activeLesson.skill,
    correct: result.correct,
    expected: result.expected,
    answer: result.answer,
    observation: result.observation,
    errorType: result.errorType,
    confidence: result.confidence,
    inferredWork: result.inferredWork,
    plannerReason: nextLesson.plannerReason
  };
  const offlineTask = chooseOfflineActivity({
    studentModel: updatedStudentModel,
    activeLesson: currentState.activeLesson,
    lastAssessment
  });
  const board = createAssessmentBoard(currentState.activeLesson, nextLesson, result);
  const tutorText = adaptTutorReply(
    createAssessmentTutorMessage(currentState.profile, currentState.activeLesson, nextLesson, result),
    currentState.profile?.ageBand
  );
  const memory = syncLegacyMemory(currentState.memory, updatedStudentModel);

  return {
    ...currentState,
    messages: [...withoutThinkingMessage(currentState.messages), { role: "tutor", text: tutorText }],
    board,
    memory,
    studentModel: updatedStudentModel,
    activeLesson: nextLesson,
    lastAssessment,
    offlineTask
  };
}

function withoutThinkingMessage(messages) {
  return messages.filter(
    (message) =>
      message.text !== "我先听懂你的问题，然后用小白板陪你一步一步来。" &&
      message.text !== "我先用小白板画出来，然后再补一句更自然的回应。"
  );
}

function handleFamilyObservation(input, currentState, studentModel) {
  const speakerName = currentState.activeSpeaker?.name || "家人";
  const isQuestion = /[？?]|(怎么|如何|要不要|可以吗|怎么办)/.test(input);
  const text = isQuestion
    ? `谢谢${speakerName}告诉我。我会把这句话记成家人的观察，不当成孩子原话。可以再说说当时发生了什么，或者孩子当时怎么说吗？`
    : `谢谢${speakerName}告诉我。我已经把这句话记成家人的观察，不会当成孩子原话。还想补充发生在什么时候吗？`;

  return {
    ...currentState,
    messages: [...withoutThinkingMessage(currentState.messages), { role: "tutor", text }],
    board: { type: "blank" },
    visualPlan: null,
    studentModel,
    growthEvidence: {
      type: "observation",
      sourceQuote: input,
      topics: [],
      domains: [],
      observation: `记录${speakerName}补充的家庭观察。`,
      childIntent: "",
      inference: "",
      confidence: 1,
      shouldSave: false
    },
    lastAssessment: null
  };
}

export function classifyActivity(input) {
  if (/(故事|童话|讲给我听|讲.*听)/.test(input)) return "story";
  if (/(加法|减法|算术|数数|数一数|练.*数字|苹果|以内.*(?:加|减)|\d+\s*[+\-])/u.test(input)) return "math";
  if (/(探索|观察|教室|户外|自然|找.*颜色|找三种颜色)/.test(input)) return "science";
  if (/(为什么|月亮|太阳|科学|昆虫|恐龙|植物)/.test(input)) return "science";
  if (/(英文|英语|word|color|颜色|单词)/i.test(input)) return "english";
  return "language";
}

function handleStoryChoice(input, currentState, studentModel, onStudentEvent) {
  const nextLesson = continueStoryLesson(input, currentState.activeLesson);
  const tutorText = adaptTutorReply(
    `${currentState.profile.name || "小朋友"}，你选了${nextLesson.story.childChoice}。${nextLesson.story.ending} 故事先停在这里。现在可以离开屏幕，把刚才的选择画出来，或者讲给家长听。`,
    currentState.profile?.ageBand
  );
  const board = {
    type: "story",
    title: `${nextLesson.story.title}：你的结尾`,
    mode: "共创 + 离屏",
    story: nextLesson.story,
    items: [nextLesson.story.character, nextLesson.story.childChoice, nextLesson.story.object, "画一画"],
    question: "你能把刚才的选择画出来，或者讲给成人听吗？",
    note: nextLesson.plannerReason
  };
  const offlineTask = chooseOfflineActivity({
    studentModel,
    activeLesson: nextLesson,
    lastAssessment: null
  });

  onStudentEvent(studentModel.studentId, "story_choice_made", {
    lessonId: currentState.activeLesson.id,
    choice: nextLesson.story.childChoice,
    recap: nextLesson.story.recap
  });

  return {
    ...currentState,
    messages: [...withoutThinkingMessage(currentState.messages), { role: "tutor", text: tutorText }],
    board,
    studentModel,
    activeLesson: nextLesson,
    offlineTask
  };
}

function createTutorMessage(input, activity, profile, studentModel, lesson) {
  const name = profile.name || "小朋友";

  if (activity === "algebra") {
    return `${name}，我们来做一个方程：${lesson.problem.left} = ${lesson.problem.right}。你可以直接回答 x 等于多少；如果你愿意，也可以写出你的展开过程。`;
  }

  if (activity === "math") {
    const mastery = studentModel.skills[lesson.skill]?.mastery || 0.3;
    return mastery < 0.45
      ? `${name}，我们先不急着算。白板上有 ${lesson.problem.total} 个${lesson.object}，我要拿走 ${lesson.problem.takeaway} 个。你先看“拿走”的动作，然后告诉我还剩几个。`
      : `${name}，这次你可以先试试看：${lesson.problem.total} 个${lesson.object}，拿走 ${lesson.problem.takeaway} 个，还剩几个？白板会帮你检查。`;
  }

  if (activity === "story") {
    const firstPrompt = lesson.story.dialogicPrompts?.[0]?.text || "你想选哪一个？";
    return `${name}，我给你讲一个原创小故事：《${lesson.story.title}》。${lesson.story.scenes.join(" ")} ${firstPrompt} 你可以选：${lesson.story.choices.join("、")}。`;
  }

  const interest = profile.interest || "你喜欢的东西";
  const messages = {
    english: `${name}，我们先学 3 个能马上用的词。看白板上的颜色，你可以跟我说：“red 是红色，blue 是蓝色，green 是绿色。”`,
    science: input.includes("颜色") || input.includes("找")
      ? `${name}，我们先做一个很短的观察任务。白板上有三种颜色，等一下你就离开屏幕，在教室或家里找一找。`
      : createScienceTutorMessage(name, input),
    language: `${name}，我听到了。你愿意再说说刚才发生了什么吗？`
  };

  return messages[activity];
}

function createBoard(input, activity, profile, lesson = null) {
  const config = activityTypes[activity];
  const common = {
    mode: "互动",
    note: createChildFacingNote(activity, config.label)
  };

  if (activity === "math") {
    const problem = lesson?.problem || { total: 5, takeaway: 2, answer: 3 };
    const object = lesson?.object || "苹果";
    return {
      ...common,
      type: "math",
      title: `${problem.total} 个${object}，拿走 ${problem.takeaway} 个`,
      items: Array.from({ length: problem.total }, () => "apple"),
      crossed: problem.takeaway,
      question: "还剩几个？"
    };
  }

  if (activity === "algebra") {
    return {
      ...common,
      type: "algebra",
      title: `${lesson.problem.left} = ${lesson.problem.right}`,
      problem: lesson.problem,
      question: "x 等于多少？也可以写出你怎么展开括号。",
      feedback: null
    };
  }

  if (activity === "english") {
    return {
      ...common,
      type: "english",
      title: "颜色单词",
      items: [
        { zh: "红色", en: "red", color: "#E86452" },
        { zh: "蓝色", en: "blue", color: "#4D8BD6" },
        { zh: "绿色", en: "green", color: "#4E9A6A" }
      ],
      question: "你最喜欢哪个颜色？"
    };
  }

  if (activity === "science") {
    if (input.includes("颜色") || input.includes("找")) {
      return {
        ...common,
        type: "science",
        title: "找三种颜色",
        items: ["红色", "黄色", "绿色"],
        question: "等一下离开屏幕，你能找到这三种颜色吗？",
        note: "先看一看，再去家里或户外找一找。"
      };
    }

    const explanation = createScienceExplanation(input);
    return {
      ...common,
      variant: explanation.variant,
      type: "science",
      title: explanation.title,
      items: explanation.items,
      question: explanation.question,
      note: explanation.note
    };
  }

  if (activity === "story") {
    return {
      ...common,
      type: "story",
      title: lesson.story.title,
      story: lesson.story,
      items: [lesson.story.character, lesson.story.setting, lesson.story.object, "孩子选择"],
      question: `你想怎么帮它？可以选：${lesson.story.choices.join("、")}`,
      note: "故事由你的选择继续，想法没有标准答案。"
    };
  }

  return {
    ...common,
    type: "language",
    title: "一起聊",
    items: ["谁", "在哪里", "做什么"],
    question: "你先说一个词，我帮你变成一句完整的话。"
  };
}

function createChildFacingNote(activity, fallbackLabel) {
  const notes = {
    story: "听一小段，做一个选择，再把故事说成自己的。",
    science: "看完白板，就去身边找一找、比一比。",
    language: "先说一个小想法，小宇会陪你把它说完整。",
    english: "一次认识几个马上能用的词就够了。",
    math: "先看一看“拿走”发生了什么，再说答案。",
    algebra: "把每一份完整地画出来，会更容易看清。"
  };

  return notes[activity] || `我们一起看看这个${fallbackLabel || "问题"}。`;
}

function createScienceTutorMessage(name, input) {
  const explanation = createScienceExplanation(input);
  return `${name}，${explanation.childReply}`;
}

function createScienceExplanation(input) {
  if (/(天空|天).*(蓝|藍)|蓝色.*天空|藍色.*天空/.test(input)) {
    return {
      variant: "sky",
      title: "天空为什么是蓝色？",
      items: ["太阳光", "空气", "蓝色光"],
      question: "蓝色光更容易被空气散开，所以我们抬头看到一大片蓝。",
      childReply: "太阳光里有很多颜色，蓝色的小光更容易被空气散开，所以天空看起来蓝蓝的。",
      note: "离屏任务：让孩子看看天空、白纸和蓝色物品，比较“看到的颜色”和“物体自己的颜色”。"
    };
  }

  if (/(树叶|叶子|叶片).*(绿|绿色)|为什么.*(树叶|叶子).*(绿|绿色)/.test(input)) {
    return {
      variant: "leaf",
      title: "树叶为什么是绿色的？",
      items: ["太阳光", "叶绿素", "绿色"],
      question: "叶绿素会用太阳光帮助植物制造养分，也让叶子看起来绿绿的。",
      childReply: "树叶里有一种叫叶绿素的绿色小帮手，它会用太阳光帮助植物制造养分，所以叶子看起来绿绿的。",
      note: "离屏任务：找两片深浅不同的叶子，比较颜色、纹路和触感。"
    };
  }

  if (/(雨|下雨|云).*哪|为什么.*雨|雨.*来/.test(input)) {
    return {
      variant: "rain",
      title: "雨从哪里来？",
      items: ["水汽", "云", "雨滴"],
      question: "小水汽挤在云里，变重了，就落下来成雨。",
      childReply: "地上的水变成小水汽飞上去，挤在云里面，云装不下时，小水滴就落下来。",
      note: "离屏任务：洗手后观察水珠，看看小水滴会不会聚在一起变大。"
    };
  }

  if (/(影子|影).*为什么|为什么.*影/.test(input)) {
    return {
      variant: "shadow",
      title: "影子为什么会出现？",
      items: ["光", "身体", "影子"],
      question: "身体挡住了光，后面就变暗，影子出现了。",
      childReply: "有光照过来时，身体把光挡住了，后面暗暗的一块就是影子。",
      note: "离屏任务：用手电筒和小玩具照一照，看看影子会不会变大变小。"
    };
  }

  if (/(月亮|月球).*(变|圆|弯|样子)|为什么.*月亮/.test(input)) {
    return {
      variant: "moon",
      title: "月亮为什么会变样？",
      items: ["太阳", "地球", "月亮"],
      question: "我们看到的是月亮被照亮的那一边。",
      childReply: "月亮不是自己变形了，是我们从地球上看到被太阳照亮的部分不一样。",
      note: "用太阳、地球、月亮的位置帮助孩子理解看到的亮面不同。"
    };
  }

  const topic = String(input || "这个发现").replace(/[？?。！!]/g, "").slice(0, 16) || "这个发现";
  return {
    variant: "observe",
    title: topic,
    items: ["看一看", "比一比", "找证据"],
    question: "我们可以先观察它是什么样，再一起找原因。",
    childReply: "这个问题很有意思。我们先看看它是什么样、什么时候会出现，再一起找原因。",
    note: "未知科学问题先引导观察，不用无关的固定答案替代。"
  };
}

function createAssessmentBoard(previousLesson, nextLesson, result) {
  if (previousLesson.activity === "algebra") {
    return {
      type: "algebra",
      title: result.correct ? "答对了，再试一个" : "把括号画开看看",
      mode: result.correct ? "继续挑战" : "一起想",
      problem: nextLesson.problem,
      question: result.correct
        ? `对。下一题：${nextLesson.problem.left} = ${nextLesson.problem.right}，x 等于多少？`
        : `如果有 ${previousLesson.problem.coefficient} 份完整的 (x + ${previousLesson.problem.constant})，一共有几个 ${previousLesson.problem.constant}？`,
      note: result.correct ? "换一组数字，看看这个方法是不是仍然好用。" : "把括号里的每一项都画出来，会更容易看清。",
      feedback: {
        correct: result.correct,
        answer: result.answer,
        expected: result.expected,
        errorType: result.errorType,
        confidence: result.confidence,
        inferredWork: result.inferredWork,
        misconception: result.misconception?.pattern
      },
      visualExplanation: result.errorType === "failed_distributive_property" ? previousLesson.problem : null
    };
  }

  return {
    type: "math",
    title: result.correct ? "答对了，再换一题" : "我们再看一次拿走动作",
    mode: result.correct ? "再试一次" : "一起数",
    items: Array.from({ length: nextLesson.problem.total }, () => "apple"),
    crossed: nextLesson.problem.takeaway,
    question: result.correct
      ? `对，是 ${result.expected} 个。下一题：${nextLesson.problem.total} 个，拿走 ${nextLesson.problem.takeaway} 个，还剩几个？`
      : `刚才答案应该是 ${result.expected}。下一题简单一点：${nextLesson.problem.total} 个，拿走 ${nextLesson.problem.takeaway} 个，还剩几个？`,
    note: result.correct ? "换一组物品再试一次。" : "跟着白板把被拿走的划掉，再数剩下的。",
    feedback: {
      correct: result.correct,
      answer: result.answer,
      expected: result.expected
    }
  };
}

function createAssessmentTutorMessage(profile, previousLesson, nextLesson, result) {
  const name = profile.name || "小朋友";
  if (previousLesson.activity === "algebra") {
    if (result.correct) {
      return `${name}，对，x = ${result.expected}。下一题我们换一个括号，看看你能不能迁移：${nextLesson.problem.left} = ${nextLesson.problem.right}。`;
    }

    if (result.errorType === "failed_distributive_property") {
      return `${name}，我不是只想说错了。我猜你可能把 ${previousLesson.problem.left} 展开成了 ${result.inferredWork}。这里容易漏掉一件事：${previousLesson.problem.coefficient} 要乘到括号里的每一项。看白板，三份 (x + ${previousLesson.problem.constant}) 里其实有三个 ${previousLesson.problem.constant}。`;
    }

    return `${name}，这个答案还不对，但我还不能确定是哪一种误区。我们先把括号画出来，再看每一份里面有什么。`;
  }

  if (result.correct) {
    return `${name}，答对了，是 ${result.expected} 个。你不是在背答案，你是在看懂“拿走以后剩下”。我们换一题：${nextLesson.problem.total} 个苹果，拿走 ${nextLesson.problem.takeaway} 个，还剩几个？`;
  }

  return `${name}，没关系，我们把动作放慢。刚才 ${previousLesson.problem.total} 个拿走 ${previousLesson.problem.takeaway} 个，剩下 ${result.expected} 个。现在换简单一点：${nextLesson.problem.total} 个苹果，拿走 ${nextLesson.problem.takeaway} 个，还剩几个？`;
}

function updateStudentMemory(memory, activity, input, studentModel) {
  const detectedTopics = ["恐龙", "汽车", "小兔", "颜色", "月亮", "太阳", "影子", "朋友", "昆虫", "植物"].filter(
    (word) => input.includes(word)
  );
  const interests = [...new Set([...(studentModel.profile.interests || []), ...(memory.interests || []), ...detectedTopics])];
  const recentWins = detectedTopics.length
    ? [`孩子主动提到了${detectedTopics.join("、")}`, ...(memory.recentWins || [])].slice(0, 4)
    : memory.recentWins || [];

  return {
    ...memory,
    interests: interests.slice(-6),
    recentWins,
    sessionCount: memory.sessionCount + 1
  };
}
