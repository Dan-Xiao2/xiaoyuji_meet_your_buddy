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
export function createDrawingJob() {
  let active;
  return {
    cancel() { active?.abort(); active = null; },
    async run(work, commit, fail) {
      active?.abort();
      const controller = new AbortController(); active = controller;
      try {
        const result = await work(controller.signal);
        if (active === controller && !controller.signal.aborted) commit(result);
      } catch (error) {
        if (active === controller && !controller.signal.aborted) fail(error);
      } finally { if (active === controller) active = null; }
    }
  };
}
