import { mergeEnrichmentState } from "../../session/enrichmentState.js";

export function latestTutorReply(nextState) {
  return findTutorMessage(nextState)?.text || "";
}

export function findTutorMessage(state, messageId) {
  const messages = state.messages || [];
  return messageId ? messages.find(message => message.role === "tutor" && message.id === messageId)
    : messages.findLast(message => message.role === "tutor");
}

export function replaceLatestTutorReply(nextState, reply) {
  if (!reply) return nextState;
  const messages = [...(nextState.messages || [])];
  const reverseIndex = [...messages].reverse().findIndex(message => message.role === "tutor");
  if (reverseIndex < 0) {
    messages.push({ role: "tutor", text: reply });
  } else {
    const index = messages.length - 1 - reverseIndex;
    messages[index] = { ...messages[index], text: reply };
  }
  return { ...nextState, messages };
}

export function createPendingConversationState(localTurn, turnId) {
  const messages = [...(localTurn.messages || [])];
  // Only the just-created local pair gets identities; legacy history is left intact.
  for (const role of ["child", "tutor"]) {
    const index = messages.findLastIndex(message => message.role === role);
    if (index >= 0) messages[index] = { ...messages[index], id: `${turnId}:${role}`, turnId };
  }
  return {
    ...localTurn,
    messages,
    board: localTurn.board || { type: "blank" },
    llmStatus: {
      provider: "qwen",
      used: false,
      fallback: false,
      pending: true,
      stage: "quick-reply",
      message: "正在准备回答"
    }
  };
}

export function createQuickReplyState(pendingState, spokenReply, quickReply, replyMessageId) {
  const quickLatencyMs = quickReply.clientLatencyMs ?? quickReply.llmStatus?.latencyMs ?? 0;
  const target = pendingState.messages?.find(message => message.id === replyMessageId && message.role === "tutor");
  if (!target) return null;
  const nextState = { ...pendingState, messages: pendingState.messages.map(message =>
    message === target ? { ...message, text: spokenReply } : message) };
  return {
    ...nextState,
    llmStatus: {
      ...nextState.llmStatus,
      quickUsed: Boolean(quickReply.llmStatus?.used),
      quickLatencyMs,
      pending: false,
      enrichmentPending: true,
      stage: "enrichment",
      message: "正在补全白板和成长记录"
    }
  };
}

export function finishWithoutEnrichment(currentState, { fallback = false } = {}) {
  return {
    ...currentState,
    llmStatus: {
      ...currentState.llmStatus,
      pending: false,
      enrichmentPending: false,
      ...(fallback ? { fallback: true } : {})
    }
  };
}

export function createEnrichedConversationState(currentState, enrichedState, {
  quickReply,
  totalLatencyMs,
  baseline,
  onConflict
}) {
  const mergedState = mergeEnrichmentState(currentState, enrichedState, { baseline, onConflict });
  return {
    ...mergedState,
    llmStatus: {
      ...(mergedState.llmStatus || {}),
      pending: false,
      enrichmentPending: false,
      stage: "complete",
      quickUsed: Boolean(quickReply.llmStatus?.used),
      quickLatencyMs: quickReply.clientLatencyMs ?? quickReply.llmStatus?.latencyMs ?? 0,
      totalLatencyMs
    }
  };
}
