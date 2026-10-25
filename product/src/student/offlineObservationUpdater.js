import { updateSkillMastery } from "./masteryModel.js";

export function applyOfflineObservation(studentModel, offlineTask, observation) {
  const skill = offlineTask?.memoryTarget || offlineTask?.sourceSkill || "language.full_sentence";
  const result = resultFromObservation(observation);
  let next = updateSkillMastery(studentModel, skill, result);

  const attentionNotes = buildAttentionNotes(next.engagement.attentionNotes || [], observation);
  const recentWins = buildRecentWins(next.engagement.recentWins || [], offlineTask, observation);
  const offlineObservations = [
    {
      taskId: offlineTask?.id,
      title: offlineTask?.title,
      skill,
      completion: observation.completion,
      support: observation.support,
      behavior: observation.behavior,
      notes: observation.notes,
      createdAt: new Date().toISOString()
    },
    ...(next.engagement.offlineObservations || [])
  ].slice(0, 10);

  return {
    ...next,
    engagement: {
      ...next.engagement,
      recentWins,
      attentionNotes,
      offlineObservations
    },
    nextLessonSuggestion: {
      skill,
      difficulty: observation.support === "much_support" ? "easy" : "easy",
      format: "offline_then_ai_short_turn",
      reason: buildNextSuggestion(observation)
    }
  };
}

export function createObservationSummary(observation, offlineTask) {
  return {
    title: offlineTask?.title || "线下任务",
    completion: labelCompletion(observation.completion),
    support: labelSupport(observation.support),
    behavior: labelBehavior(observation.behavior),
    notes: observation.notes || "未填写补充观察",
    createdAt: new Date().toISOString()
  };
}

function resultFromObservation(observation) {
  const completed = observation.completion === "completed";
  const independent = observation.support === "no_support";
  const muchSupport = observation.support === "much_support";

  return {
    correct: completed && !muchSupport,
    needsHint: !independent,
    masteryDelta: completed && independent ? 0.06 : muchSupport ? -0.03 : 0.02
  };
}

function buildAttentionNotes(existing, observation) {
  const notes = [...existing];
  if (observation.behavior === "distracted") notes.unshift("线下任务中容易分心，下一次需要更短、更有身体动作的活动。");
  if (observation.behavior === "high_interest") notes.unshift("线下任务兴趣高，可以继续用相似主题延展。");
  if (observation.support === "much_support") notes.unshift("线下任务需要较多成人提示，下一次降低指令复杂度。");
  return [...new Set(notes)].slice(0, 6);
}

function buildRecentWins(existing, offlineTask, observation) {
  if (observation.completion === "completed") {
    return [`完成线下任务：${offlineTask?.title || "现实探索"}`, ...existing].slice(0, 5);
  }

  if (observation.completion === "partial") {
    return [`尝试了线下任务：${offlineTask?.title || "现实探索"}`, ...existing].slice(0, 5);
  }

  return existing.slice(0, 5);
}

function buildNextSuggestion(observation) {
  if (observation.completion === "not_interested") return "孩子对当前任务兴趣不高，下次优先换成兴趣主题或运动型任务。";
  if (observation.support === "much_support") return "孩子需要较多提示，下次用更少步骤和更多实物示范。";
  if (observation.behavior === "recounted") return "孩子倾向重新数一遍，可以继续观察是否理解数量变化，而不急着写算式。";
  return "孩子能参与线下活动，下次可以用同一技能换一个真实场景验证迁移。";
}

function labelCompletion(value) {
  return {
    completed: "完成了",
    partial: "做了一部分",
    not_interested: "不太感兴趣"
  }[value];
}

function labelSupport(value) {
  return {
    no_support: "基本不用提示",
    some_support: "需要一点提示",
    much_support: "需要很多提示"
  }[value];
}

function labelBehavior(value) {
  return {
    expressed: "主动表达",
    recounted: "重新数了一遍",
    distracted: "容易分心",
    high_interest: "明显感兴趣"
  }[value];
}
