import { selectModelDiagnostics } from "../../services/modelDiagnostics.js";
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
    }
  };
}

export function createQuickReplyState(pendingState, spokenReply, quickReply, candidate) {
  const quickLatencyMs = quickReply.clientLatencyMs ?? quickReply.llmStatus?.latencyMs ?? 0;
  const childIndex = pendingState.messages.findIndex(message => message.id === `${candidate.turnId}:child`);
  const reply = { id: candidate.id, turnId: candidate.turnId, role: "tutor", text: spokenReply };
  const nextState = { ...pendingState, messages: [
    ...pendingState.messages.slice(0, childIndex + 1), reply, ...pendingState.messages.slice(childIndex + 1)
  ] };
  return {
    ...nextState,
    llmStatus: {
      ...selectModelDiagnostics(quickReply.llmStatus),
      quickUsed: Boolean(quickReply.llmStatus?.used),
      quickLatencyMs
    }
  };
}

export function finishWithoutEnrichment(currentState, { fallback = false } = {}) {
  return {
    ...currentState,
    llmStatus: {
      ...selectModelDiagnostics(currentState.llmStatus),
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
      ...selectModelDiagnostics(mergedState.llmStatus),
      quickUsed: Boolean(quickReply.llmStatus?.used),
      quickLatencyMs: quickReply.clientLatencyMs ?? quickReply.llmStatus?.latencyMs ?? 0,
      totalLatencyMs
    }
  };
}

// Current candidates live only in the controller; stopping never removes accepted history.
export function cancelPendingConversationState(currentState) {
  const status = currentState.llmStatus;
  if (!status?.pending && !status?.enrichmentPending) return currentState;
  return {
    ...currentState,
    llmStatus: selectModelDiagnostics(status)
  };
}

// Only at page load: older versions persisted the identified pending pair.
export function recoverInterruptedConversationState(savedState) {
  const status = savedState.llmStatus;
  const messages = savedState.messages || [];
  const candidate = messages.at(-1), child = messages.at(-2);
  const legacyCandidate = status?.pending && status.stage === "quick-reply" &&
    candidate?.role === "tutor" && candidate.turnId && candidate.id === `${candidate.turnId}:tutor` &&
    child?.role === "child" && child.id === `${candidate.turnId}:child` && child.turnId === candidate.turnId;
  return cancelPendingConversationState(legacyCandidate ? { ...savedState, messages: messages.slice(0, -1) } : savedState);
}
