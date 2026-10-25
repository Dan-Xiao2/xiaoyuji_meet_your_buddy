import { createSafetyTurn } from "../../services/safety.js";

const evidenceFields = ["memory", "studentModel", "growthEvidence"];
const statusFields = ["provider", "model", "used", "fallback", "pending", "enrichmentPending", "stage", "message", "quickUsed", "quickLatencyMs", "latencyMs", "totalLatencyMs", "tokenUsage", "knowledgeCardIds", "knowledgeIntent", "groundingFallback", "drawingClaimFallback"];
const snapshot = value => JSON.stringify(value);
const selectStatus = value => Object.fromEntries(statusFields.filter(key => Object.hasOwn(value || {}, key)).map(key => [key, structuredClone(value[key])]));

// These are internal submissions, not model responses or whole application snapshots.
export function createConversationCommit(current, next, { kind, turnId }) {
  const replyMessageId = `${turnId}:tutor`;
  const childMessageId = `${turnId}:child`;
  const commit = {
    kind, turnId, sessionId: current.session?.id, sessionStatus: current.session?.status,
    replyMessageId, childMessageId,
    expectedReply: snapshot(current.messages.find(message => message.id === replyMessageId)),
    expectedChild: snapshot(current.messages.find(message => message.id === childMessageId)),
    expectedStatus: snapshot(current.llmStatus)
  };
  if (kind === "protected") return { ...commit, safetyReply: next.safetyDecision.reply };
  commit.llmStatus = selectStatus(next.llmStatus);
  if (kind === "quick") commit.reply = next.messages.find(message => message.id === replyMessageId)?.text;
  if (kind === "complete") {
    commit.evidence = {};
    commit.baseline = {};
    for (const field of evidenceFields) {
      if (snapshot(next[field]) === snapshot(current[field])) continue;
      commit.evidence[field] = structuredClone(next[field]);
      commit.baseline[field] = snapshot(current[field]);
    }
  }
  return commit;
}

export function applyConversationCommit(current, commit) {
  const rejected = { accepted: false, state: current, conflicts: [] };
  if (!commit || !["quick", "complete", "protected"].includes(commit.kind) ||
      current.session?.id !== commit.sessionId || current.session?.status !== commit.sessionStatus ||
      current.session?.status === "ended" || !commit.expectedReply || !commit.expectedChild ||
      snapshot(current.llmStatus) !== commit.expectedStatus ||
      snapshot(current.messages.find(message => message.id === commit.replyMessageId)) !== commit.expectedReply ||
      snapshot(current.messages.find(message => message.id === commit.childMessageId)) !== commit.expectedChild) return rejected;

  if (commit.kind === "protected") {
    const state = createSafetyTurn({ ...current,
      messages: current.messages.filter(message => message.id !== commit.replyMessageId && message.id !== commit.childMessageId)
    }, { protected: true, category: "output", reply: commit.safetyReply });
    return { accepted: true, state, conflicts: [] };
  }
  const state = { ...current, llmStatus: { ...current.llmStatus, ...selectStatus(commit.llmStatus) } };
  const conflicts = [];
  if (commit.kind === "quick") {
    state.messages = current.messages.map(message => message.id === commit.replyMessageId ? { ...message, text: commit.reply } : message);
  } else {
    for (const field of evidenceFields) {
      if (!Object.hasOwn(commit.evidence || {}, field)) continue;
      if (snapshot(current[field]) !== commit.baseline[field]) { conflicts.push(field); continue; }
      state[field] = structuredClone(commit.evidence[field]);
    }
  }
  return { accepted: true, state, conflicts };
}
