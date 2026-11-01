import { ensureFamilyState, syncPrimaryChild } from "../data/familyModel.js";
import { ensureStudentModel } from "../student/studentSchema.js";
import { createActiveSession, endActiveSession } from "../session/sessionManager.js";
import { relevantBoard } from "../whiteboard/visualPlan.js";
import { selectModelDiagnostics } from "../services/modelDiagnostics.js";

export function normalizeApplicationState(nextState) {
  const lastInput = [...(nextState.messages || [])]
    .reverse()
    .find(message => message.role === "child")?.text || "";

  return {
    ...nextState,
    llmStatus: selectModelDiagnostics(nextState.llmStatus),
    family: ensureFamilyState(nextState.family, nextState.profile),
    board: relevantBoard(nextState.board, lastInput, nextState.board)
  };
}

export function updateProfileState(current, profile) {
  const next = { ...current, profile: { ...current.profile, ...profile } };
  return { ...next, family: syncPrimaryChild(current.family, next.profile), studentModel: ensureStudentModel(next) };
}

export function startSessionState(current, profile, now = new Date()) {
  if (current.session?.status === "active") return current;
  const next = updateProfileState(current, profile);
  return {
    ...next,
    session: createActiveSession(next.studentModel.studentId, now),
    messages: [], drawingRequest: null, board: { type: "blank" },
    activeLesson: null, lastAssessment: null, lastSessionSummary: null, growthEvidence: null
  };
}

export function endSessionState(current, moments, now = new Date()) {
  if (current.session?.status !== "active") return current;
  const ended = endActiveSession(current.session, moments, now);
  return { ...current, session: ended.session, lastSessionSummary: ended.summary };
}
