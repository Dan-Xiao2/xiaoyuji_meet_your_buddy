import { isDrawingRetry } from "../services/conversationIntent.js";

export function drawingRequestInput(input, state) {
  if (!isDrawingRetry(input)) return input;
  const request = state.drawingRequest;
  return request?.sessionId === state.session?.id && typeof request?.input === "string"
    ? request.input.slice(0, 1000) : null;
}

export const MAX_IMAGE_LENGTH = 260000;
export function validImageBoard(board) {
  return board?.type === "image" && typeof board.id === "string" && board.id.length < 100 &&
    Number.isSafeInteger(board.revision) && board.revision > 0 &&
    typeof board.image === "string" && board.image.length <= MAX_IMAGE_LENGTH &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(board.image);
}

export function imageBoard(image, previous, instruction) {
  const history = previous?.type === "image" ? [...(previous.history || []), { ...previous, history: undefined }] : previous?.type === "scene" ? [previous] : [];
  const board = { type: "image", title: "一起画", id: previous?.id || crypto.randomUUID(),
    revision: (previous?.revision || 0) + 1, image, instruction: instruction.slice(0, 600), history: history.slice(-3) };
  if (!validImageBoard(board)) throw new Error("invalid-image");
  return board;
}

export function undoImageBoard(board) {
  const history = board?.history || [];
  if (!history.length) return null;
  const previous = history.at(-1);
  return previous.type === "image" ? { ...previous, history: history.slice(0, -1) } : previous;
}

// One job per session. A later drawing or session end invalidates late responses.
export function createDrawingJob({ trace = () => {} } = {}) {
  let active, sequence = 0, snapshot = { phase: "idle" };
  function cancel() {
    if (!active) return;
    active.controller.abort();
    trace("drawing.cancelled", { ...active.identity, reason: "stopped" });
    snapshot = { ...active.identity, phase: "cancelled" };
    active = null;
  }
  return {
    cancel,
    getSnapshot: () => Object.freeze({ ...snapshot }),
    async run(work, commit, fail, context = {}) {
      cancel();
      const controller = new AbortController();
      const identity = { taskId: `drawing-image-${++sequence}`, phase: "image",
        sessionId: context.sessionId, turnId: context.turnId, baseRevision: context.baseRevision };
      const job = { controller, identity }; active = job;
      snapshot = { ...identity, phase: "pending" };
      trace("drawing.requested", identity);
      let received = false;
      try {
        const result = await work(controller.signal);
        received = true;
        trace("drawing.received", identity);
        if (active !== job || controller.signal.aborted) {
          trace("drawing.rejected", { ...identity, reason: "stale-task" });
          return;
        }
        const accepted = commit(result) !== false;
        trace(accepted ? "drawing.accepted" : "drawing.rejected", { ...identity, reason: accepted ? undefined : "base-changed" });
        if (active === job) snapshot = { ...identity, phase: accepted ? "complete" : "rejected" };
      } catch (error) {
        if (active === job && !controller.signal.aborted) {
          snapshot = { ...identity, phase: "failed" };
          trace("drawing.failed", { ...identity, reason: received ? "publish-failed" : "request-failed" });
          fail(error);
        } else trace("drawing.rejected", { ...identity, reason: "stale-task" });
      } finally { if (active === job) active = null; }
    }
  };
}
