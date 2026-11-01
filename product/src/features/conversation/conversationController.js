import { callQuickTutorApi, callTutorApi } from "../../services/llmClient.js";
import { checkTutorSafetyOutput, createSafetyTurn } from "../../services/safety.js";
import { captureEnrichmentBaseline } from "../../session/enrichmentState.js";
import { createConversationCommit, applyConversationCommit } from "./conversationCommit.js";
import {
  createEnrichedConversationState,
  createPendingConversationState,
  createQuickReplyState,
  finishWithoutEnrichment
} from "./conversationState.js";

const defaultClock = () => globalThis.performance?.now?.() ?? Date.now();

export function createConversationController({
  quickApi = callQuickTutorApi,
  enrichmentApi = callTutorApi,
  clock = defaultClock,
  trace = () => {}, onChange = () => {}
} = {}) {
  let revision = 0;
  let startedRevision = 0;
  let activeController = null;
  let offered = null, replyAccepted = false;

  let runtime = { phase: "idle", revision: 0 };
  const getSnapshot = () => Object.freeze({ ...runtime, replyAccepted,
    awaitingReply: !replyAccepted && ["started", "pending", "quick", "result-ready"].includes(runtime.phase) });
  const offer = commit => (offered = commit);
  function accept(turn, current, submission) {
    if (!isCurrent(turn) || offered !== submission || submission?.turnId !== turn.turnId) {
      return { accepted: false, state: current, conflicts: [], reason: isCurrent(turn) ? "duplicate-result" : "stale-turn" };
    }
    // A delivery is consumed once, including a domain conflict.
    offered = null;
    const result = applyConversationCommit(current, submission);
    if (result.accepted) {
      if (submission.kind === "quick") replyAccepted = true;
      onChange();
    }
    return result;
  }
  const describe = turn => ({ sessionId: turn?.sessionId, turnId: turn?.turnId, revision: turn?.id });
  function mark(turn, phase) {
    if (isCurrent(turn)) { runtime = { ...runtime, phase }; onChange(); }
  }
  function reject(turn, reason) {
    if (isCurrent(turn)) offered = null;
    trace("conversation.rejected", { ...describe(turn), reason });
    mark(turn, "rejected");
    return { status: "cancelled" };
  }
  async function request(turn, phase, work) {
    mark(turn, phase);
    trace("conversation.requested", { ...describe(turn), phase });
    try {
      const result = await work();
      trace("conversation.received", { ...describe(turn), phase });
      return result;
    } catch (error) {
      trace("conversation.failed", { ...describe(turn), phase, reason: "request-failed" });
      mark(turn, "failed");
      throw error;
    }
  }
  function ready(turn, result) {
    mark(turn, "result-ready");
    trace("conversation.result-ready", { ...describe(turn), phase: result.status });
    return { ...result, commit: offer(result.commit) };
  }
  function settle(turn, accepted, phase, reason = "commit-rejected") {
    if (!isCurrent(turn)) {
      trace("conversation.rejected", { ...describe(turn), phase, reason: "stale-turn" });
      return;
    }
    trace(accepted ? "conversation.accepted" : "conversation.rejected", {
      ...describe(turn), phase, reason: accepted ? undefined : reason
    });
    if (!accepted) offered = null;
    if (phase === "complete" || phase === "protected" || !accepted) mark(turn, accepted ? phase : reason === "request-failed" ? "failed" : "rejected");
  }

  function begin({ sessionId = null, captureRevision } = {}) {
    cancel();
    activeController = new AbortController();
    const turn = { id: revision, sessionId, turnId: globalThis.crypto.randomUUID(), signal: activeController.signal };
    runtime = { phase: "started", revision, sessionId, turnId: turn.turnId,
      childMessageId: `${turn.turnId}:child`, replyMessageId: `${turn.turnId}:tutor` };
    trace("conversation.started", { ...runtime, captureRevision });
    replyAccepted = false;
    onChange();
    return Object.freeze(turn);
  }

  function cancel() {
    activeController?.abort();
    activeController = null;
    offered = null;
    if (["started", "pending", "quick", "enrichment", "result-ready", "failed"].includes(runtime.phase)) {
      trace("conversation.cancelled", { ...runtime, reason: "stopped" });
      runtime = { ...runtime, phase: "cancelled" };
    }
    revision += 1;
    onChange();
  }

  function isCurrent(turn) {
    return Boolean(turn) && turn.id === revision && !turn.signal.aborted;
  }

  async function run({
    turn,
    input,
    stateForRequest,
    localTurn,
    fallbackReply,
    evidenceBaseline,
    getState,
    onPending,
    onQuickReply
  }) {
    if (!isCurrent(turn)) return reject(turn, "stale-turn");
    if (startedRevision === turn.id) {
      trace("conversation.rejected", { ...describe(turn), reason: "duplicate-run" });
      return { status: "cancelled" };
    }
    runtime = { ...runtime, sessionId: stateForRequest.session?.id, phase: "pending" };
    startedRevision = turn.id;
    const startedAt = clock();
    let currentState = createPendingConversationState(localTurn, turn.turnId);
    const replyMessageId = `${turn.turnId}:tutor`;
    const childMessageId = `${turn.turnId}:child`;
    const targetSnapshot = (state, id) => JSON.stringify(state.messages?.find(message => message.id === id));
    // The local candidate stays in this call, never in the pending submission/history.
    const candidateReply = currentState.messages.find(message => message.id === replyMessageId);
    let replySnapshot;
    const childSnapshot = targetSnapshot(currentState, childMessageId);
    if (!candidateReply || !childSnapshot) return reject(turn, "missing-target");
    const enrichmentBaseline = evidenceBaseline ?? captureEnrichmentBaseline(currentState);
    const latestState = () => getState?.() ?? currentState;
    const invalidReason = () => {
      const latest = latestState();
      if (!isCurrent(turn)) return "stale-turn";
      if (latest.session?.id !== stateForRequest.session?.id) return "session-changed";
      if (latest.session?.status === "ended") return "session-inactive";
      if (targetSnapshot(latest, childMessageId) !== childSnapshot) return "source-changed";
      if (targetSnapshot(latest, replyMessageId) !== replySnapshot) return "reply-changed";
      return null;
    };
    const pendingBase = latestState();
    if (pendingBase.session?.id !== stateForRequest.session?.id || pendingBase.session?.status !== "active") {
      return reject(turn, "session-inactive");
    }
    const pendingCommit = offer(createConversationCommit(pendingBase, currentState, {
      kind: "pending", turnId: turn.turnId, baseline: stateForRequest
    }));
    const acceptedPending = onPending?.(pendingCommit);
    if (!acceptedPending) return reject(turn, "pending-rejected");
    if (!isCurrent(turn)) return reject(turn, "stale-turn");
    currentState = acceptedPending;
    if (invalidReason()) return reject(turn, invalidReason());

    const quickReply = await request(turn, "quick", () => quickApi({ input, state: stateForRequest, fallbackReply }, { signal: turn.signal }));
    if (invalidReason()) return reject(turn, invalidReason());

    const spokenReply = quickReply.reply || fallbackReply;
    if (!checkTutorSafetyOutput(spokenReply).ok) {
      activeController = null;
      return ready(turn, {
        status: "protected",
        spokenReply: "这句话我需要再确认，不能随便给你建议。",
        commit: createConversationCommit(latestState(), createSafetyTurn({ ...latestState(),
          messages: latestState().messages.filter(message => message.turnId !== turn.turnId)
        }, {
          protected: true,
          category: "output",
          reply: "这句话我需要再确认，不能随便给你建议。"
        }), { kind: "protected", turnId: turn.turnId })
      });
    }

    const quickBase = latestState();
    currentState = createQuickReplyState(quickBase, spokenReply, quickReply, candidateReply);
    const quickCommit = offer(createConversationCommit(quickBase, currentState, { kind: "quick", turnId: turn.turnId }));
    replySnapshot = targetSnapshot(currentState, replyMessageId);
    const acceptedState = await onQuickReply?.(quickCommit, {
      replyMessageId,
      spokenReply,
      quickReply,
      quickLatencyMs: currentState.llmStatus.quickLatencyMs
    });
    if (acceptedState === false) return reject(turn, "quick-rejected");
    if (acceptedState) currentState = acceptedState;
    if (invalidReason()) return reject(turn, invalidReason());

    if (!quickReply.llmStatus?.used) {
      activeController = null;
      return ready(turn, {
        status: "complete",
        replyMessageId,
        commit: createConversationCommit(latestState(), finishWithoutEnrichment(latestState()), { kind: "complete", turnId: turn.turnId }),
        spokenReply,
        quickReply,
        enriched: false
      });
    }

    const enrichedState = await request(turn, "enrichment", () => enrichmentApi({
      input,
      state: stateForRequest,
      spokenReply
    }, { signal: turn.signal }));
    if (invalidReason()) return reject(turn, invalidReason());

    if (!enrichedState) {
      activeController = null;
      return ready(turn, {
        status: "complete",
        replyMessageId,
        commit: createConversationCommit(latestState(), finishWithoutEnrichment(latestState()), { kind: "complete", turnId: turn.turnId }),
        spokenReply,
        quickReply,
        enriched: false
      });
    }

    const enrichmentOutput = {
      board: enrichedState.board,
      offlineTask: enrichedState.offlineTask,
      growthEvidence: enrichedState.growthEvidence,
      memory: enrichedState.memory
    };
    if (!checkTutorSafetyOutput(enrichmentOutput).ok) {
      activeController = null;
      return ready(turn, {
        status: "complete",
        replyMessageId,
        commit: createConversationCommit(latestState(), finishWithoutEnrichment(latestState(), { fallback: true }), { kind: "complete", turnId: turn.turnId }),
        spokenReply,
        quickReply,
        enriched: false
      });
    }

    const totalLatencyMs = Math.round(clock() - startedAt);
    const enrichmentConflicts = [];
    const completedState = createEnrichedConversationState(latestState(), enrichedState, {
      quickReply,
      totalLatencyMs,
      baseline: enrichmentBaseline,
      onConflict: field => enrichmentConflicts.push(field)
    });
    activeController = null;
    return ready(turn, {
      status: "complete",
      replyMessageId,
      commit: createConversationCommit(latestState(), completedState, { kind: "complete", turnId: turn.turnId }),
      spokenReply,
      quickReply,
      enriched: true,
      enrichmentConflicts,
      totalLatencyMs
    });
  }

  return { begin, cancel, isCurrent, run, accept, settle, getSnapshot };
}
