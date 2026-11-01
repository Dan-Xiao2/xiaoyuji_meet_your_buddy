import { selectModelDiagnostics as selectStatus } from "../../services/modelDiagnostics.js";
import { incrementSessionTurn } from "../../session/sessionManager.js";
import { createSafetyTurn, safeConversationMessages } from "../../services/safety.js";

const pendingFields = ["board", "visualPlan", "drawingRequest", "activeLesson", "lastAssessment", "offlineTask",
  "safetyDecision", "safetyContext", "memory", "studentModel", "growthEvidence"];
const evidenceFields = ["memory", "studentModel", "growthEvidence"];
const snapshot = value => JSON.stringify(value);

// These are internal submissions. The controller owns their one-time acceptance; this module only validates/merges business data.
export function createConversationCommit(current, next, { kind, turnId, baseline = current }) {
  const replyMessageId = `${turnId}:tutor`;
  const childMessageId = `${turnId}:child`;
  const commit = {
    kind, turnId, sessionId: current.session?.id, sessionStatus: current.session?.status,
    replyMessageId, childMessageId,
    expectedReply: snapshot(current.messages.find(message => message.id === replyMessageId)),
    expectedChild: snapshot(current.messages.find(message => message.id === childMessageId))
  };
  if (kind === "pending") {
    const changes = {}, expected = {};
    for (const field of pendingFields) {
      if (!Object.hasOwn(next, field) || snapshot(next[field]) === snapshot(baseline[field])) continue;
      changes[field] = structuredClone(next[field]);
      expected[field] = snapshot(baseline[field]);
    }
    return { ...commit, expectedMessages: snapshot(current.messages),
      child: structuredClone(next.messages.find(message => message.id === childMessageId)),
      changes, baseline: expected, llmStatus: selectStatus(next.llmStatus) };
  }
  if (kind === "protected") return { ...commit, safetyReply: next.safetyDecision.reply };
  commit.llmStatus = selectStatus(next.llmStatus);
  if (kind === "quick") {
    const reply = next.messages.find(message => message.id === replyMessageId);
    commit.reply = reply && { id: replyMessageId, turnId, role: "tutor", text: reply.text };
  }
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
  const rejected = () => ({ accepted: false, state: current, conflicts: [], reason: rejectionReason(current, commit) });
  if (commit?.kind === "pending") {
    if (current.session?.id !== commit.sessionId || current.session?.status !== commit.sessionStatus ||
        current.session?.status !== "active" || snapshot(current.messages) !== commit.expectedMessages ||
        current.messages.some(message => message.id === commit.replyMessageId) ||
        commit.child?.id !== commit.childMessageId || commit.child?.turnId !== commit.turnId ||
        commit.child?.role !== "child" || typeof commit.child.text !== "string") return rejected();
    const child = structuredClone(commit.child);
    const messages = safeConversationMessages(current.messages);
    const childIndex = messages.findIndex(message => message.id === commit.childMessageId);
    if (childIndex < 0) messages.push(child);
    else messages[childIndex] = child;
    const state = { ...current, messages, llmStatus: selectStatus(commit.llmStatus) };
    const conflicts = [];
    for (const field of pendingFields) {
      if (!Object.hasOwn(commit.changes || {}, field)) continue;
      if (snapshot(current[field]) !== commit.baseline[field]) { conflicts.push(field); continue; }
      state[field] = structuredClone(commit.changes[field]);
    }
    return { accepted: true, state, conflicts };
  }
  if (!commit || !["quick", "complete", "protected"].includes(commit.kind) ||
      current.session?.id !== commit.sessionId || current.session?.status !== commit.sessionStatus ||
      current.session?.status === "ended" || !commit.expectedChild ||
      (commit.kind === "complete" ? !commit.expectedReply : commit.expectedReply !== undefined) ||
      snapshot(current.messages.find(message => message.id === commit.replyMessageId)) !== commit.expectedReply ||
      snapshot(current.messages.find(message => message.id === commit.childMessageId)) !== commit.expectedChild) return rejected();

  if (commit.kind === "quick" && (commit.reply?.id !== commit.replyMessageId || commit.reply?.turnId !== commit.turnId ||
      commit.reply?.role !== "tutor" || typeof commit.reply?.text !== "string")) return rejected();

  if (commit.kind === "protected") {
    const state = createSafetyTurn({ ...current,
      messages: current.messages.filter(message => message.id !== commit.replyMessageId && message.id !== commit.childMessageId)
    }, { protected: true, category: "output", reply: commit.safetyReply });
    return { accepted: true, state: { ...state, llmStatus: selectStatus(state.llmStatus) }, conflicts: [] };
  }
  const state = { ...current, llmStatus: { ...selectStatus(current.llmStatus), ...selectStatus(commit.llmStatus) } };
  const conflicts = [];
  if (commit.kind === "quick") {
    state.session = incrementSessionTurn(current.session);
    const childIndex = current.messages.findIndex(message => message.id === commit.childMessageId);
    const reply = { id: commit.replyMessageId, turnId: commit.turnId, role: "tutor", text: commit.reply.text };
    state.messages = [...current.messages.slice(0, childIndex + 1), reply, ...current.messages.slice(childIndex + 1)];
  } else {
    for (const field of evidenceFields) {
      if (!Object.hasOwn(commit.evidence || {}, field)) continue;
      if (snapshot(current[field]) !== commit.baseline[field]) { conflicts.push(field); continue; }
      state[field] = structuredClone(commit.evidence[field]);
    }
  }
  return { accepted: true, state, conflicts };
}

// Explain an already rejected submission; this does not replace the acceptance checks above.
function rejectionReason(current, commit) {
  if (!commit || !["pending", "quick", "complete", "protected"].includes(commit.kind)) return "invalid-submission";
  if (current.session?.id !== commit.sessionId) return "session-changed";
  if (current.session?.status !== commit.sessionStatus || current.session?.status === "ended" ||
      (commit.kind === "pending" && current.session?.status !== "active")) return "session-inactive";
  if (commit.kind === "pending") {
    if (current.messages.some(message => message.id === commit.replyMessageId)) return "duplicate-result";
    if (snapshot(current.messages) !== commit.expectedMessages) return "messages-changed";
    return "invalid-submission";
  }
  if (!commit.expectedChild || (commit.kind === "complete" && !commit.expectedReply)) return "missing-target";
  if (commit.kind !== "complete" && (commit.expectedReply !== undefined || current.messages.some(message => message.id === commit.replyMessageId))) return "duplicate-result";
  if (snapshot(current.messages.find(message => message.id === commit.childMessageId)) !== commit.expectedChild) return "source-changed";
  if (snapshot(current.messages.find(message => message.id === commit.replyMessageId)) !== commit.expectedReply) return "reply-changed";
  return "commit-rejected";
}
