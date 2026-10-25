import { callQuickTutorApi, callTutorApi } from "../../services/llmClient.js";
import { checkTutorSafetyOutput, createSafetyTurn } from "../../services/safety.js";
import { captureEnrichmentBaseline } from "../../session/enrichmentState.js";
import { createConversationCommit } from "./conversationCommit.js";
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
  clock = defaultClock
} = {}) {
  let revision = 0;
  let startedRevision = 0;
  let activeController = null;

  function begin() {
    activeController?.abort();
    activeController = new AbortController();
    revision += 1;
    return { id: revision, turnId: globalThis.crypto.randomUUID(), signal: activeController.signal };
  }

  function cancel() {
    activeController?.abort();
    activeController = null;
    revision += 1;
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
    if (!isCurrent(turn) || startedRevision === turn.id) return { status: "cancelled" };
    startedRevision = turn.id;
    const startedAt = clock();
    let currentState = createPendingConversationState(localTurn, turn.turnId);
    const replyMessageId = `${turn.turnId}:tutor`;
    const childMessageId = `${turn.turnId}:child`;
    const targetSnapshot = (state, id) => JSON.stringify(state.messages?.find(message => message.id === id));
    let replySnapshot = targetSnapshot(currentState, replyMessageId);
    const childSnapshot = targetSnapshot(currentState, childMessageId);
    if (!replySnapshot || !childSnapshot) return { status: "cancelled" };
    const enrichmentBaseline = evidenceBaseline ?? captureEnrichmentBaseline(currentState);
    const latestState = () => getState?.() ?? currentState;
    const isLiveTurn = () => {
      const latest = latestState();
      return isCurrent(turn) && latest.session?.id === stateForRequest.session?.id &&
        latest.session?.status !== "ended" &&
        targetSnapshot(latest, replyMessageId) === replySnapshot &&
        targetSnapshot(latest, childMessageId) === childSnapshot;
    };
    onPending?.(currentState);

    const quickReply = await quickApi({ input, state: stateForRequest, fallbackReply }, { signal: turn.signal });
    if (!isLiveTurn()) return { status: "cancelled" };

    const spokenReply = quickReply.reply || fallbackReply;
    if (!checkTutorSafetyOutput(spokenReply).ok) {
      activeController = null;
      return {
        status: "protected",
        spokenReply: "这句话我需要再确认，不能随便给你建议。",
        commit: createConversationCommit(latestState(), createSafetyTurn({ ...latestState(),
          messages: latestState().messages.filter(message => message.turnId !== turn.turnId)
        }, {
          protected: true,
          category: "output",
          reply: "这句话我需要再确认，不能随便给你建议。"
        }), { kind: "protected", turnId: turn.turnId })
      };
    }

    const quickBase = latestState();
    currentState = createQuickReplyState(quickBase, spokenReply, quickReply, replyMessageId);
    const quickCommit = createConversationCommit(quickBase, currentState, { kind: "quick", turnId: turn.turnId });
    replySnapshot = targetSnapshot(currentState, replyMessageId);
    const acceptedState = await onQuickReply?.(quickCommit, {
      replyMessageId,
      spokenReply,
      quickReply,
      quickLatencyMs: currentState.llmStatus.quickLatencyMs
    });
    if (acceptedState === false) return { status: "cancelled" };
    if (acceptedState) currentState = acceptedState;
    if (!isLiveTurn()) return { status: "cancelled" };

    if (!quickReply.llmStatus?.used) {
      activeController = null;
      return {
        status: "complete",
        replyMessageId,
        commit: createConversationCommit(latestState(), finishWithoutEnrichment(latestState()), { kind: "complete", turnId: turn.turnId }),
        spokenReply,
        quickReply,
        enriched: false
      };
    }

    const enrichedState = await enrichmentApi({
      input,
      state: stateForRequest,
      spokenReply
    }, { signal: turn.signal });
    if (!isLiveTurn()) return { status: "cancelled" };

    if (!enrichedState) {
      activeController = null;
      return {
        status: "complete",
        replyMessageId,
        commit: createConversationCommit(latestState(), finishWithoutEnrichment(latestState()), { kind: "complete", turnId: turn.turnId }),
        spokenReply,
        quickReply,
        enriched: false
      };
    }

    const enrichmentOutput = {
      board: enrichedState.board,
      offlineTask: enrichedState.offlineTask,
      growthEvidence: enrichedState.growthEvidence,
      memory: enrichedState.memory
    };
    if (!checkTutorSafetyOutput(enrichmentOutput).ok) {
      activeController = null;
      return {
        status: "complete",
        replyMessageId,
        commit: createConversationCommit(latestState(), finishWithoutEnrichment(latestState(), { fallback: true }), { kind: "complete", turnId: turn.turnId }),
        spokenReply,
        quickReply,
        enriched: false
      };
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
    return {
      status: "complete",
      replyMessageId,
      commit: createConversationCommit(latestState(), completedState, { kind: "complete", turnId: turn.turnId }),
      spokenReply,
      quickReply,
      enriched: true,
      enrichmentConflicts,
      totalLatencyMs
    };
  }

  return { begin, cancel, isCurrent, run };
}
