export function createInitialStudentModel(profile = {}, studentId = profile.studentId || "local-demo-student") {
  return {
    schemaVersion: 2,
    studentId,
    profile: {
      ageBand: profile.ageBand || "4-5",
      nickname: profile.name || "",
      interests: splitInterest(profile.interest || ""),
      learningGoal: profile.goal || ""
    },
    learningStyle: {
      prefersStoryContext: null,
      needsVisualSupport: null,
      benefitsFromShortTurns: true,
      praiseStyle: "specific",
      evidenceCount: 0
    },
    skills: {
      "math.counting_1_to_5": createSkill(),
      "math.subtract_as_takeaway": createSkill(),
      "math.answer_after_visual_prompt": createSkill(),
      "language.full_sentence": createSkill()
    },
    growthProfile: {
      evidenceCount: 0,
      interestSignals: [],
      recentQuestions: [],
      familyObservations: []
    },
    workArtifacts: [],
    misconceptions: [],
    engagement: {
      sessionCount: 0,
      recentWins: [],
      attentionNotes: []
    },
    nextLessonSuggestion: {}
  };
}

export function migrateStudentModel(studentModel, profile = {}) {
  if (!studentModel || typeof studentModel !== "object") return createInitialStudentModel(profile);
  if (isLegacySeedModel(studentModel)) return createInitialStudentModel(profile);

  const fresh = createInitialStudentModel(profile);
  return {
    ...fresh,
    ...studentModel,
    profile: { ...fresh.profile, ...(studentModel.profile || {}) },
    learningStyle: { ...fresh.learningStyle, ...(studentModel.learningStyle || {}) },
    skills: Object.fromEntries(
      Object.entries({ ...fresh.skills, ...preschoolSkills(studentModel.skills) }).map(([key, skill]) => [
        key,
        {
          ...fresh.skills[key],
          ...skill,
          evidence: { ...fresh.skills[key]?.evidence, ...(skill?.evidence || {}) }
        }
      ])
    ),
    misconceptions: Array.isArray(studentModel.misconceptions) ? studentModel.misconceptions : [],
    engagement: { ...fresh.engagement, ...(studentModel.engagement || {}) },
    growthProfile: { ...fresh.growthProfile, ...(studentModel.growthProfile || {}) },
    workArtifacts: Array.isArray(studentModel.workArtifacts) ? studentModel.workArtifacts : [],
    nextLessonSuggestion: studentModel.nextLessonSuggestion || {}
  };
}

export function ensureStudentModel(state) {
  if (state.profile?.studentId && state.studentModel?.studentId !== state.profile.studentId) {
    return createInitialStudentModel(state.profile, state.profile.studentId);
  }
  if (state.studentModel) {
    return {
      ...state.studentModel,
      profile: {
        ...state.studentModel.profile,
        nickname: state.profile?.name || state.studentModel.profile.nickname,
        ageBand: state.profile?.ageBand || state.studentModel.profile.ageBand,
        interests: splitInterest(state.profile?.interest || state.studentModel.profile.interests.join("、")),
        learningGoal: state.profile?.goal || state.studentModel.profile.learningGoal
      }
    };
  }

  return createInitialStudentModel(state.profile);
}

function createSkill() {
  return {
    mastery: null,
    status: "unobserved",
    evidence: {
      attempts: 0,
      correct: 0,
      needsHint: 0,
      lastResult: "not_started"
    }
  };
}

function preschoolSkills(skills = {}) {
  return Object.fromEntries(Object.entries(skills).filter(([key]) => key !== "algebra.distributive_property"));
}

function isLegacySeedModel(studentModel) {
  const skills = Object.values(studentModel.skills || {});
  const noSkillEvidence = skills.length > 0 && skills.every((skill) => (skill?.evidence?.attempts || 0) === 0);
  const legacyWin = studentModel.engagement?.recentWins?.includes("能跟随提示说出自己的想法");
  const legacyMisconception = studentModel.misconceptions?.some(
    (item) => item.id === "subtraction_means_count_all" && !item.lastSeenAt
  );
  return noSkillEvidence && legacyWin && legacyMisconception;
}

function splitInterest(value) {
  if (Array.isArray(value)) return value;
  return value
    .split(/[、,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}
