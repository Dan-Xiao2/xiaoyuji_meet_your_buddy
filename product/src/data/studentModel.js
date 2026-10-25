import { loadStudentModel } from "./localStudentDb.js";
import { createInitialOfflineTask } from "../offline/offlineActivityLibrary.js";
import { createInitialFamily } from "./familyModel.js";

export function createInitialState() {
  const profile = {
    name: "",
    ageBand: "4-5",
    interest: "",
    goal: "",
    consent: false,
    parentPinHash: "",
    showSessionSummary: true,
    configured: false
  };

  return {
    uiVersion: 2,
    profile,
    family: createInitialFamily(profile),
    messages: [],
    board: {
      type: "blank"
    },
    memory: {
      mastery: {},
      misconceptions: [],
      interests: [],
      recentWins: [],
      sessionCount: 0
    },
    studentModel: loadStudentModel("local-demo-student", profile),
    activeLesson: null,
    lastAssessment: null,
    offlineTask: createInitialOfflineTask(),
    lastOfflineObservation: null,
    session: {
      status: "idle",
      id: null,
      startedAt: null,
      endedAt: null,
      turnCount: 0
    },
    lastSessionSummary: null
  };
}
