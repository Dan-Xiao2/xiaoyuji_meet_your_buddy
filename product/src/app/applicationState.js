import { ensureFamilyState } from "../data/familyModel.js";
import { relevantBoard } from "../whiteboard/visualPlan.js";

export function normalizeApplicationState(nextState) {
  const lastInput = [...(nextState.messages || [])]
    .reverse()
    .find(message => message.role === "child")?.text || "";

  return {
    ...nextState,
    family: ensureFamilyState(nextState.family, nextState.profile),
    board: relevantBoard(nextState.board, lastInput, nextState.board)
  };
}
