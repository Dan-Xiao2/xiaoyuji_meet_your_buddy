import { replaceLatestTutorReply } from "../conversation/conversationState.js";
import { captureEnrichmentBaseline } from "../../session/enrichmentState.js";

// Observe every commit, not just model revision numbers: undo can restore an older revision.
// Only a serialized comparison stamp is retained, never a second writable board.
export function createDrawingGuard() {
  let stamp;
  let revision = 0;
  function observe(board) {
    const next = JSON.stringify(board);
    if (next !== stamp) { stamp = next; revision += 1; }
    return revision;
  }
  return {
    observe,
    capture(state) { return { sessionId: state.session?.id, revision: observe(state.board) }; },
    matches(state, base) {
      return state.session?.status === "active" && state.session.id === base.sessionId &&
        observe(state.board) === base.revision;
    }
  };
}

const turnFields = ["messages", "board", "visualPlan", "drawingRequest", "llmStatus",
  "activeLesson", "lastAssessment", "offlineTask", "safetyDecision", "safetyContext"];

export function mergeDrawingTurn(current, turn, evidenceBaseline) {
  const next = { ...current };
  for (const field of turnFields) {
    if (Object.hasOwn(turn, field)) next[field] = turn[field];
  }
  for (const field of ["memory", "studentModel", "growthEvidence"]) {
    if (Object.hasOwn(turn, field) && JSON.stringify(current[field]) === evidenceBaseline[field]) {
      next[field] = turn[field];
    }
  }
  return next;
}

export function drawingContinuationBaseline(current, turn, requestBaseline) {
  const baseline = captureEnrichmentBaseline(turn);
  for (const field of Object.keys(baseline)) {
    // Keep conflicts from routing, but accept this turn's own initial evidence reset.
    if (JSON.stringify(current[field]) !== requestBaseline[field]) baseline[field] = requestBaseline[field];
  }
  return baseline;
}

export function retainUpdatedDrawing(current, turn) {
  return replaceLatestTutorReply({
    ...turn, board: current.board, drawingRequest: current.drawingRequest,
    visualPlan: { changed: false }, growthEvidence: null,
    llmStatus: { ...turn.llmStatus, pending: false, enrichmentPending: false, fallback: true, stage: "drawing-stale" }
  }, "画面刚刚更新了，这次没有继续修改。你可以接着告诉我怎么改。");
}
