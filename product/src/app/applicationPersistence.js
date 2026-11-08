import { saveState } from "../services/storage.js";
import { persistStudentModel, recordGrowthMoment, appendStudentEvent,
  startStudentSession, finishStudentSession, setGrowthMomentsStarred } from "../data/localStudentDb.js";

// Ordinary application writes only. Archive replacement/recovery keep their journal and consent flow.
// With "保存孩子的成长记录" switched off (profile.consent === false) the family can still chat, but
// nothing new enters the growth archive: no growth moments, learning events, observations or
// session records. The profile itself is still saved. Older data without the field keeps saving.
const keepsGrowthRecords = state => state?.profile?.consent !== false;
// These sequential writes are not a transaction: an error may follow a successful earlier write.
export function createApplicationPersistence({ onFailure = () => {}, writes = {
  saveState, persistStudentModel, recordGrowthMoment, appendStudentEvent,
  startStudentSession, finishStudentSession, setGrowthMomentsStarred
} } = {}) {
  let snapshotState;
  let snapshotResult;

  function attempt(operation, write) {
    const result = { ok: false, operation, completed: [], moment: null };
    function step(name, ...args) {
      result.failedAt = name;
      const value = writes[name](...args);
      result.completed.push(name);
      return value;
    }
    try {
      write(step, result);
      result.ok = true;
      delete result.failedAt;
    } catch (error) {
      result.error = error;
      onFailure(result);
    }
    return result;
  }

  function modelAndEvents(step, state, events) {
    step("persistStudentModel", state.studentModel);
    for (const event of events) step("appendStudentEvent", ...event);
  }

  return {
    saveSnapshot(state) {
      snapshotState = state;
      snapshotResult = attempt("snapshot", step => step("saveState", state));
      return snapshotResult;
    },
    isSnapshotSaved(state) { return snapshotState === state && snapshotResult?.ok === true; },
    saveProfile(state) {
      return attempt("profile", step => step("persistStudentModel", state.studentModel));
    },
    saveTurn(state, { moment = null, events = [] } = {}) {
      return attempt("turn", (step, result) => {
        if (!keepsGrowthRecords(state)) return;
        if (moment) result.moment = step("recordGrowthMoment", moment);
        modelAndEvents(step, state, events);
      });
    },
    saveObservation(state, taskId, observation) {
      return attempt("observation", step => keepsGrowthRecords(state) && modelAndEvents(step, state, [
        [state.studentModel.studentId, "lesson_completed", { source: "offline_observation", taskId, observation }]
      ]));
    },
    startSession(state) {
      return attempt("session-start", step => {
        step("persistStudentModel", state.studentModel);
        if (!keepsGrowthRecords(state)) return;
        step("startStudentSession", state.studentModel.studentId, state.session.id, state.session.startedAt);
        step("appendStudentEvent", state.studentModel.studentId, "session_started", {
          sessionId: state.session.id, activeSpeakerId: state.family.activeSpeakerId
        });
      });
    },
    finishSession(state) {
      return attempt("session-end", step => {
        if (!keepsGrowthRecords(state)) return;
        step("finishStudentSession", state.session.id, state.lastSessionSummary, state.session.endedAt);
        step("appendStudentEvent", state.studentModel.studentId, "session_ended", {
          sessionId: state.session.id, turnCount: state.session.turnCount,
          momentIds: state.lastSessionSummary?.momentIds || []
        });
      });
    },
    starMoments(ids, starred) {
      return attempt("star", step => step("setGrowthMomentsStarred", ids, starred));
    }
  };
}
