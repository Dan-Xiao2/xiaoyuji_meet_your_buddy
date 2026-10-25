import { createInitialStudentModel, migrateStudentModel } from "../student/studentSchema.js";
import { recoverArchiveTransaction, assertArchiveRevision } from "../services/localPersistence.js";
import { validBlockScene } from "../whiteboard/visualPlan.js";
import { validIllustrationScene } from "../whiteboard/illustrationPlan.js";
import { normalizeDrawingScene } from "../whiteboard/drawingScene.js";
import { mayArchiveMoment } from "../services/safety.js";
import { isInteractionControl } from "../services/conversationIntent.js";
import { clearDurableArchive, scheduleDurableArchive } from "../services/indexedArchive.js";
import { readArchiveValue } from "../services/archiveIntegrity.js";

const LOCAL_STUDENT_DB_KEY = "xiaoyuji-local-student-db-v1";
const LEGACY_LOCAL_STUDENT_DB_KEY = "momo-learning-local-student-db";
const LOCAL_STUDENT_DB_VERSION = 3;
let memoryDb = createEmptyLocalStudentDb();

export function loadLocalStudentDb() {
  if (!hasLocalStorage()) return memoryDb;
  recoverArchiveTransaction(window.localStorage);

  const saved = readArchiveValue(window.localStorage, LOCAL_STUDENT_DB_KEY);
  return saved ? normalizeLocalStudentDb(saved) : createEmptyLocalStudentDb();
}

export function saveLocalStudentDb(db) {
  const normalizedDb = normalizeLocalStudentDb(db);
  if (!hasLocalStorage()) {
    memoryDb = normalizedDb;
    return;
  }

  assertArchiveRevision(window.localStorage);
  readArchiveValue(window.localStorage, LOCAL_STUDENT_DB_KEY);
  window.localStorage.setItem(LOCAL_STUDENT_DB_KEY, JSON.stringify(normalizedDb));
  scheduleDurableArchive(window.localStorage);
  memoryDb = normalizedDb;
}

export function clearLocalStudentDb() {
  memoryDb = createEmptyLocalStudentDb();
  if (hasLocalStorage()) {
    window.localStorage.removeItem(LOCAL_STUDENT_DB_KEY);
    window.localStorage.removeItem(LEGACY_LOCAL_STUDENT_DB_KEY);
    clearDurableArchive();
  }
}

export function loadStudentModel(studentId = "local-demo-student", profile = {}) {
  const db = loadLocalStudentDb();
  return db.studentModels[studentId]
    ? migrateStudentModel(db.studentModels[studentId], profile)
    : createInitialStudentModel(profile, studentId);
}

export function persistStudentModel(studentModel) {
  const db = loadLocalStudentDb();
  const normalizedModel = migrateStudentModel(studentModel, studentModel.profile);
  const nextDb = {
    ...db,
    studentModels: {
      ...db.studentModels,
      [normalizedModel.studentId]: normalizedModel
    },
    updatedAt: new Date().toISOString()
  };
  saveLocalStudentDb(nextDb);
  return nextDb;
}

export function startStudentSession(studentId, sessionId, startedAt = new Date().toISOString()) {
  const db = loadLocalStudentDb();
  const session = normalizeSession({
    id: sessionId || createId(),
    studentId,
    status: "active",
    startedAt,
    plannedEndAt: null,
    durationMinutes: null,
    endedAt: null,
    turnCount: 0,
    summary: null
  });
  saveLocalStudentDb({
    ...db,
    sessions: [session, ...db.sessions.filter((item) => item.id !== session.id)],
    updatedAt: session.startedAt
  });
  return session;
}

export function finishStudentSession(sessionId, summary, endedAt = new Date().toISOString()) {
  const db = loadLocalStudentDb();
  const sessionMoments = db.growthMoments.filter((item) => item.sessionId === sessionId);
  const nextDb = {
    ...db,
    sessions: db.sessions.map((item) =>
      item.id === sessionId
        ? normalizeSession({
            ...item,
            status: "ended",
            endedAt,
            turnCount: sessionMoments.length,
            summary
          })
        : item
    ),
    updatedAt: endedAt
  };
  saveLocalStudentDb(nextDb);
  return nextDb.sessions.find((item) => item.id === sessionId) || null;
}

export function getStudentSessions(studentId = "local-demo-student") {
  return loadLocalStudentDb().sessions.filter((item) => item.studentId === studentId);
}

export function appendStudentEvent(studentId, type, payload = {}) {
  const db = loadLocalStudentDb();
  const event = {
    id: createId(),
    studentId,
    type,
    payload,
    createdAt: new Date().toISOString()
  };

  const nextDb = {
    ...db,
    events: [event, ...db.events].slice(0, 200),
    updatedAt: event.createdAt
  };

  saveLocalStudentDb(nextDb);
  return event;
}

export function recordGrowthMoment({
  updateId,
  expectedRevision,
  studentId,
  sessionId,
  childQuote,
  tutorResponse,
  domain,
  domains,
  topics,
  lessonTitle,
  boardSnapshot,
  parentNote,
  sourceType = "child_utterance",
  speakerId,
  speakerName,
  speakerRole,
  evidence,
  sourceModel,
  reviewEligible = true,
  confidence = 1,
  parentConfirmed = false,
  safetyProtected = false,
  observedAt
}) {
  if (!mayArchiveMoment({ childQuote, parentNote, safetyProtected })) return null;
  const db = loadLocalStudentDb();
  const previous = updateId ? db.growthMoments.find((item) => item.id === updateId && item.studentId === studentId) : null;
  // Late enrichment must never resurrect a deleted or parent-corrected record.
  if (updateId && (!previous || previous.parentEdited)) return previous;
  if (updateId && (previous.revision !== expectedRevision || previous.sessionId !== cleanText(sessionId, 100))) return null;
  const createdAt = new Date().toISOString();
  const primaryDomain = normalizeDomain(domain || domains?.[0]);
  const moment = normalizeGrowthMoment({
    id: previous?.id || createId(),
    revision: previous ? previous.revision + 1 : 1,
    studentId,
    sessionId,
    childQuote,
    tutorResponse,
    domain: primaryDomain,
    domains: [primaryDomain, ...(domains || [])],
    topics,
    lessonTitle,
    boardSnapshot,
    parentNote: previous?.parentNote || parentNote,
    sourceType,
    speakerId,
    speakerName,
    speakerRole,
    evidence,
    sourceModel,
    reviewEligible,
    confidence,
    parentConfirmed,
    starred: previous?.starred || false,
    observedAt: previous?.observedAt || observedAt || createdAt,
    updatedAt: createdAt,
    createdAt: previous?.createdAt || createdAt
  });

  const nextDb = {
    ...db,
    growthMoments: previous ? db.growthMoments.map((item) => item.id === previous.id && item.studentId === studentId ? moment : item) : [moment, ...db.growthMoments],
    updatedAt: createdAt
  };

  saveLocalStudentDb(nextDb);
  return moment;
}

export function getStudentGrowthMoments(studentId = "local-demo-student") {
  return loadLocalStudentDb().growthMoments.filter((item) => item.studentId === studentId);
}

export function setGrowthMomentsStarred(ids, starred = true) {
  const selectedIds = new Set(ids);
  if (!selectedIds.size) return loadLocalStudentDb();

  const db = loadLocalStudentDb();
  const updatedAt = new Date().toISOString();
  const nextDb = {
    ...db,
    growthMoments: db.growthMoments.map((item) =>
      selectedIds.has(item.id)
        ? { ...item, revision: item.revision + 1, starred: Boolean(starred), saved: Boolean(starred), updatedAt }
        : item
    ),
    updatedAt
  };
  saveLocalStudentDb(nextDb);
  return nextDb;
}

// Compatibility aliases keep existing UI and older local records working during migration.
export function recordConversationMoment({ studentId, childText, tutorText, domain, lessonTitle }) {
  return recordGrowthMoment({
    studentId,
    childQuote: childText,
    tutorResponse: tutorText,
    domain,
    lessonTitle
  });
}

export function getStudentConversationMoments(studentId = "local-demo-student") {
  return getStudentGrowthMoments(studentId);
}

export function setConversationMomentsSaved(ids, saved = true) {
  return setGrowthMomentsStarred(ids, saved);
}

export function exportSupabaseLikeRows(studentModel) {
  const now = new Date().toISOString();
  const studentId = studentModel.studentId;

  return {
    students: [
      {
        id: studentId,
        nickname: studentModel.profile.nickname,
        age_band: studentModel.profile.ageBand,
        learning_goal: studentModel.profile.learningGoal,
        consent_for_pilot: true,
        updated_at: now
      }
    ],
    student_interests: studentModel.profile.interests.map((label) => ({
      student_id: studentId,
      label,
      source: "local_profile",
      evidence_count: 1,
      last_seen_at: now
    })),
    student_skill_mastery: Object.entries(studentModel.skills).map(([skillId, skill]) => ({
      student_id: studentId,
      skill_id: skillId,
      mastery: skill.mastery,
      status: skill.status,
      attempts: skill.evidence.attempts,
      correct_attempts: skill.evidence.correct,
      hint_count: skill.evidence.needsHint,
      last_result: skill.evidence.lastResult,
      updated_at: now
    })),
    student_misconceptions: studentModel.misconceptions.map((item) => ({
      student_id: studentId,
      skill_id: item.skill,
      misconception_key: item.id,
      description: item.pattern,
      evidence_count: item.evidenceCount,
      active: true,
      last_seen_at: item.lastSeenAt || now
    })),
    learning_style_observations: Object.entries(studentModel.learningStyle).map(([dimension, value]) => ({
      student_id: studentId,
      dimension,
      strength: typeof value === "boolean" ? (value ? 0.8 : 0.2) : 0.5,
      confidence: 0.35,
      evidence_count: 1,
      notes: String(value),
      updated_at: now
    })),
    offline_observations: (studentModel.engagement.offlineObservations || []).map((item) => ({
      student_id: studentId,
      task_id: item.taskId,
      task_title: item.title,
      skill_id: item.skill,
      completion: item.completion,
      support: item.support,
      behavior: item.behavior,
      notes: item.notes,
      created_at: item.createdAt
    }))
  };
}

function hasLocalStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createEmptyLocalStudentDb() {
  return {
    schemaVersion: LOCAL_STUDENT_DB_VERSION,
    studentModels: {},
    events: [],
    sessions: [],
    growthMoments: [],
    updatedAt: null
  };
}

export function normalizeLocalStudentDb(value) {
  const empty = createEmptyLocalStudentDb();
  if (!value || typeof value !== "object") return empty;

  const sourceMoments = Array.isArray(value.growthMoments)
    ? value.growthMoments
    : Array.isArray(value.conversationMoments)
      ? value.conversationMoments
      : [];

  return {
    schemaVersion: LOCAL_STUDENT_DB_VERSION,
    studentModels: value.studentModels && typeof value.studentModels === "object" ? value.studentModels : {},
    events: Array.isArray(value.events) ? value.events : [],
    sessions: Array.isArray(value.sessions) ? value.sessions.map(normalizeSession) : [],
    growthMoments: sourceMoments.map(normalizeGrowthMoment).filter((item) => item.childQuote || item.tutorResponse),
    updatedAt: normalizeNullableDate(value.updatedAt)
  };
}

function normalizeGrowthMoment(value) {
  const createdAt = normalizeDate(value?.createdAt, new Date().toISOString());
  const observedAt = normalizeDate(value?.observedAt, createdAt);
  const childQuote = cleanText(value?.childQuote || value?.childText, 360);
  const tutorResponse = cleanText(value?.tutorResponse || value?.tutorText, 1200);
  const normalizedDomains = normalizeLabels(
    value?.domains || [value?.primaryDomain || value?.domain],
    normalizeDomain,
    6
  );
  const primaryDomain = normalizedDomains[0] || "language";
  const starred = Boolean(value?.starred ?? value?.saved);

  return {
    schemaVersion: LOCAL_STUDENT_DB_VERSION,
    id: cleanText(value?.id, 100) || createId(),
    revision: Number.isSafeInteger(value?.revision) && value.revision > 0 ? value.revision : 1,
    studentId: cleanText(value?.studentId, 100) || "local-demo-student",
    sessionId: cleanText(value?.sessionId, 100),
    observedAt,
    childQuote,
    tutorResponse,
    topics: normalizeLabels(value?.topics, (item) => cleanText(item, 40), 12),
    domains: normalizedDomains.length ? normalizedDomains : [primaryDomain],
    primaryDomain,
    domain: primaryDomain,
    lessonTitle: cleanText(value?.lessonTitle, 100),
    boardSnapshot: normalizeBoardSnapshot(value?.boardSnapshot),
    parentNote: cleanText(value?.parentNote, 500),
    sourceType: normalizeSourceType(value?.sourceType),
    speakerId: cleanText(value?.speakerId, 80),
    speakerName: cleanText(value?.speakerName, 24),
    speakerRole: normalizeSpeakerRole(value?.speakerRole),
    evidence: normalizeEvidence(value?.evidence, childQuote),
    sourceModel: cleanText(value?.sourceModel, 80) || "local_rules",
    reviewEligible: value?.reviewEligible !== false && (normalizeSourceType(value?.sourceType) === "parent_note" || !isInteractionControl(childQuote)),
    confidence: clampNumber(value?.confidence, 0, 1, 1),
    parentConfirmed: Boolean(value?.parentConfirmed),
    parentEdited: Boolean(value?.parentEdited),
    starred,
    saved: starred,
    status: value?.status === "reviewed" ? "reviewed" : "captured",
    createdAt,
    updatedAt: normalizeDate(value?.updatedAt, createdAt),
    childText: childQuote,
    tutorText: tutorResponse
  };
}

function normalizeSession(value) {
  const startedAt = normalizeDate(value?.startedAt, new Date().toISOString());
  return {
    id: cleanText(value?.id, 100) || createId(),
    studentId: cleanText(value?.studentId, 100) || "local-demo-student",
    status: value?.status === "ended" ? "ended" : "active",
    startedAt,
    plannedEndAt: null,
    durationMinutes: null,
    endedAt: value?.endedAt ? normalizeDate(value.endedAt, null) : null,
    turnCount: Math.max(0, Math.round(Number(value?.turnCount) || 0)),
    summary: normalizeSessionSummary(value?.summary)
  };
}

function normalizeSessionSummary(value) {
  if (!value || typeof value !== "object") return null;
  return {
    title: cleanText(value.title, 100),
    standoutQuote: cleanText(value.standoutQuote, 360),
    topics: normalizeLabels(value.topics, (item) => cleanText(item, 40), 12),
    domains: normalizeLabels(value.domains, normalizeDomain, 8),
    parentPrompt: cleanText(value.parentPrompt, 240),
    momentIds: normalizeLabels(value.momentIds, (item) => cleanText(item, 100), 30)
  };
}

function normalizeEvidence(value, childQuote) {
  const evidence = value && typeof value === "object" ? value : {};
  const sourceQuote = cleanText(evidence.sourceQuote, 360);
  return {
    type: normalizeEvidenceType(evidence.type),
    sourceQuote: childQuote.includes(sourceQuote) ? sourceQuote : childQuote,
    observation: cleanText(evidence.observation, 240),
    childIntent: cleanText(evidence.childIntent, 80),
    inference: cleanText(evidence.inference, 180),
    confidence: clampNumber(evidence.confidence, 0, 1, sourceQuote ? 0.7 : 1)
  };
}

function normalizeBoardSnapshot(board) {
  if (!board || typeof board !== "object") return null;

  const snapshot = {
    type: cleanText(board.type, 40),
    mode: cleanText(board.mode, 40),
    title: cleanText(board.title, 100),
    question: cleanText(board.question, 240),
    note: cleanText(board.note, 240),
    items: Array.isArray(board.items) ? board.items.slice(0, 16).map((item) => cleanText(item, 60)).filter(Boolean) : []
  };

  if (validBlockScene(board)) {
    const scene = board.scene;
    snapshot.scene = {
      kind: "blocks", id: scene.id, revision: scene.revision,
      total: scene.total, given: scene.given, fromGiven: scene.fromGiven,
      recipient: scene.recipient,
      steps: scene.steps.map(step => ({ given: step.given, text: step.text }))
    };
  }

  if (validIllustrationScene(board)) {
    snapshot.scene = normalizeDrawingScene(board.scene);
  }
  if (board.story && typeof board.story === "object") {
    snapshot.story = {
      id: cleanText(board.story.id, 80),
      title: cleanText(board.story.title, 100),
      character: cleanText(board.story.character, 80),
      setting: cleanText(board.story.setting, 80)
    };
  }

  const hasContent = Object.values(snapshot).some((value) => (Array.isArray(value) ? value.length : Boolean(value)));
  return hasContent ? snapshot : null;
}

function normalizeDomain(value) {
  const supported = ["story", "science", "math", "language", "english", "explore", "art", "social"];
  return supported.includes(value) ? value : "language";
}

function normalizeSourceType(value) {
  const supported = ["child_utterance", "parent_note", "offline_observation", "imported"];
  return supported.includes(value) ? value : "child_utterance";
}

function normalizeSpeakerRole(value) {
  const supported = ["child", "mother", "father", "grandparent", "caregiver", "other"];
  return supported.includes(value) ? value : "child";
}

function normalizeEvidenceType(value) {
  const supported = ["question", "interest", "expression", "choice", "attempt", "story", "observation"];
  return supported.includes(value) ? value : "question";
}

function normalizeLabels(values, transform, limit) {
  const source = Array.isArray(values) ? values : values ? [values] : [];
  return [...new Set(source.map(transform).filter(Boolean))].slice(0, limit);
}

function normalizeDate(value, fallback) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeNullableDate(value) {
  if (!value) return null;
  return normalizeDate(value, null);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanText(value, limit) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
