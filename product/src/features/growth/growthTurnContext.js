import { validImageBoard } from "../../whiteboard/openDrawing.js";

// Capture only this turn's accepted visual/lesson context. A retained screen is not new evidence.
// Keep this local to the turn and reuse it when enrichment updates the same growth moment.
export function captureGrowthTurnContext(candidate, accepted) {
  const plan = candidate.visualPlan;
  const eligible = !plan?.needsPlanner && plan?.changed !== false;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const lesson = (!candidate.activeSpeaker || candidate.activeSpeaker.role === "child") &&
    same(candidate.activeLesson, accepted.activeLesson) ? candidate.activeLesson : null;
  const proposedBoard = eligible ? plan?.board || (lesson ? candidate.board : null) : null;
  const board = proposedBoard && same(proposedBoard, accepted.board) ? proposedBoard : null;
  const domain = board?.scene?.kind === "illustration" ? "art" : board?.scene?.kind === "blocks" ? "math"
    : lesson?.activity || board?.type;
  return structuredClone({
    eligible,
    domain: domain === "algebra" ? "math" : [undefined, "blank", "safety", "welcome"].includes(domain) ? "language" : domain,
    lessonTitle: lesson?.title || board?.title || "",
    boardSnapshot: validImageBoard(board) ? null : board,
    topics: [...(Array.isArray(board?.items) ? board.items.filter(item => typeof item === "string" &&
      !["谁", "在哪里", "做什么", "画一画"].includes(item)) : []),
      lesson?.story?.title || board?.story?.title || board?.title].filter(Boolean)
  });
}
