import { normalizeLocalStudentDb } from "./localStudentDb.js";
import { createInitialStudentModel, migrateStudentModel } from "../student/studentSchema.js";
import { ensureFamilyState } from "./familyModel.js";
import { syncLegacyMemory } from "../student/memoryUpdater.js";
import { createInitialOfflineTask } from "../offline/offlineActivityLibrary.js";

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const domains = ["story", "science", "math", "language", "english", "explore", "art", "social"];
const object = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const fail = (message) => { throw new Error(message); };

function safeTree(value, depth = 0) {
  if (depth > 40) fail("备份内容层级异常。");
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) fail("备份包含不支持的字段。");
    safeTree(item, depth + 1);
  }
}

function validateShape(template, value) {
  if (!object(value)) fail("备份的数据结构不完整。");
  for (const [key, sample] of Object.entries(template)) {
    if (!(key in value) || sample === null) continue;
    const item = value[key];
    if (Array.isArray(sample)) {
      if (!Array.isArray(item)) fail("备份的数据结构不完整。");
    } else if (object(sample)) validateShape(sample, item);
    else if (typeof sample !== typeof item) fail("备份的数据类型不正确。");
  }
}

function idleState(profile, family, studentModel) {
  return {
    uiVersion: 4, profile, family, studentModel,
    memory: syncLegacyMemory({ mastery: {} }, studentModel),
    messages: [], board: { type: "blank" }, activeLesson: null,
    lastAssessment: null, growthEvidence: null, llmStatus: null,
    offlineTask: createInitialOfflineTask(), lastOfflineObservation: null,
    lastSessionSummary: null,
    session: { status: "idle", id: null, startedAt: null, endedAt: null, turnCount: 0 }
  };
}

export function parseArchiveBackup(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) fail("请选择不超过 10MB 的完整备份。");
  let value;
  try { value = JSON.parse(text); } catch { fail("无法读取文件，请选择小宇记导出的完整 JSON 备份。"); }
  safeTree(value);
  if (value?.product !== "小宇记" || value?.schemaVersion !== 3 || !object(value.state) || !object(value.localArchive)) {
    fail("请选择小宇记的完整备份（v3），单条记录下载不能用于恢复。");
  }
  const source = value.state;
  if (!object(source.profile) || !object(source.studentModel)) fail("备份缺少孩子资料。");
  for (const key of ["name", "ageBand", "interest", "goal", "parentPinHash"]) {
    if (source.profile[key] !== undefined && typeof source.profile[key] !== "string") fail("孩子资料格式不正确。");
  }
  for (const key of ["consent", "configured", "showSessionSummary"]) {
    if (source.profile[key] !== undefined && typeof source.profile[key] !== "boolean") fail("家庭设置格式不正确。");
  }
  if (!["3-4", "4-5", "5-6", "6-7"].includes(source.profile.ageBand)) fail("当前版本暂不支持备份中的年龄段。");
  const studentId = source.studentModel.studentId;
  if (typeof studentId !== "string" || !studentId || studentId.length > 100) fail("备份缺少有效档案编号。");
  const profile = {
    name: (source.profile.name || "").slice(0, 24),
    ageBand: source.profile.ageBand,
    interest: (source.profile.interest || "").slice(0, 200),
    goal: (source.profile.goal || "").slice(0, 200),
    parentPinHash: source.profile.parentPinHash || "",
    consent: Boolean(source.profile.consent),
    configured: Boolean(source.profile.configured || source.profile.name),
    showSessionSummary: source.profile.showSessionSummary !== false,
    studentId
  };
  const fresh = createInitialStudentModel(profile, studentId);
  validateShape(fresh, source.studentModel);
  for (const skill of Object.values(source.studentModel.skills || {})) {
    validateShape(fresh.skills["language.full_sentence"], skill);
  }
  for (const item of source.studentModel.misconceptions || []) {
    if (!object(item) || typeof item.pattern !== "string") fail("备份的观察记录格式不正确。");
  }
  for (const values of [source.studentModel.profile?.interests, source.studentModel.engagement?.recentWins]) {
    if (values && values.some((item) => typeof item !== "string")) fail("备份的兴趣记录格式不正确。");
  }
  const observations = source.studentModel.engagement?.offlineObservations;
  if (observations !== undefined && (!Array.isArray(observations) || observations.some((item) => !object(item) || !Number.isFinite(Date.parse(item.createdAt))))) fail("备份的线下观察格式不正确。");
  if (source.family != null && (!object(source.family) || !Array.isArray(source.family.members) || source.family.members.some((item) => !object(item)))) fail("家庭资料格式不正确。");
  if ((source.family?.members?.filter((item) => item.role === "child").length || 0) > 1 || (source.family?.members?.length || 0) > 7) fail("当前版本只支持一个孩子和最多六位家长。");
  const archive = value.localArchive;
  if (!Array.isArray(archive.growthMoments) || !Array.isArray(archive.sessions) || !Array.isArray(archive.events) || !object(archive.studentModels)) fail("完整备份缺少成长档案。");
  if (Object.keys(archive.studentModels).some((id) => id !== studentId)) fail("备份含有其他孩子的档案，暂不能恢复。");
  const ids = new Set();
  for (const item of archive.growthMoments) {
    if (!object(item) || typeof item.id !== "string" || !item.id.trim() || item.id.length > 100 || item.id !== item.id.trim() || ids.has(item.id) || item.studentId !== studentId) fail("记录编号重复或孩子归属不一致。");
    if (!Array.isArray(item.topics) || item.topics.length > 12 || item.topics.some((topic) => typeof topic !== "string" || topic.length > 40)) fail("记录的主题格式不正确。");
    if (typeof item.childQuote !== "string" || typeof item.tutorResponse !== "string" || (!item.childQuote && !item.tutorResponse) || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.observedAt))) fail("记录的原话或日期格式不正确。");
    if (item.childQuote.length > 360 || item.tutorResponse.length > 1200) fail("记录内容超出当前版本支持的长度。");
    ids.add(item.id);
  }
  for (const rows of [archive.sessions, archive.events]) {
    const rowIds = new Set();
    for (const item of rows) {
      if (!object(item) || item.studentId !== studentId || typeof item.id !== "string" || !item.id || rowIds.has(item.id)) fail("会话或事件的编号、归属不正确。");
      rowIds.add(item.id);
    }
  }
  const model = migrateStudentModel(source.studentModel, profile);
  const db = normalizeLocalStudentDb(archive);
  db.studentModels = { [studentId]: model };
  db.sessions = db.sessions.map((session) => ({ ...session, status: "ended", endedAt: session.endedAt || session.startedAt }));
  return { state: idleState(profile, ensureFamilyState(source.family || {}, profile), model), db, exportedAt: value.exportedAt };
}

export function changeArchiveMoment(state, archive, id, changes, remove = false) {
  if (state.session?.status === "active") fail("请先结束聊天，再整理记录。");
  const studentId = state.studentModel.studentId;
  const db = normalizeLocalStudentDb(archive);
  const moment = db.growthMoments.find((item) => item.id === id && item.studentId === studentId);
  if (!moment) fail("这条记录已不存在，请刷新后重试。");
  const now = new Date().toISOString();
  let updated;
  if (!remove) {
    const quote = String(changes.childQuote ?? moment.childQuote).trim();
    if (!quote || quote.length > 360) fail("原话需要填写，最多 360 字。");
    const topics = (changes.topics ?? moment.topics);
    if (!Array.isArray(topics) || topics.length > 12 || topics.some((topic) => typeof topic !== "string" || topic.length > 40)) fail("最多填写 12 个主题，每个不超过 40 字。");
    const note = String(changes.parentNote ?? moment.parentNote);
    if (note.length > 500) fail("备注最多 500 字。");
    const domain = changes.domain ?? moment.domain;
    if (!domains.includes(domain)) fail("请选择有效领域。");
    updated = {
      ...moment, revision: moment.revision + 1, childQuote: quote, childText: quote, topics, domain, primaryDomain: domain, domains: [domain],
      parentNote: note, parentConfirmed: Boolean(changes.parentConfirmed ?? moment.parentConfirmed),
      reviewEligible: (changes.reviewEligible ?? moment.reviewEligible) !== false, parentEdited: true, status: "reviewed", updatedAt: now
    };
    if (quote !== moment.childQuote || domain !== moment.domain || JSON.stringify(topics) !== JSON.stringify(moment.topics)) {
      updated.evidence = { type: "observation", sourceQuote: quote, observation: "", inference: "", childIntent: "", confidence: 1 };
      updated.boardSnapshot = null;
      updated.lessonTitle = "";
    }
  }
  db.growthMoments = db.growthMoments.flatMap((item) => item.id === id && item.studentId === studentId ? (remove ? [] : [updated]) : [item]);
  const invalidatesEvidence = remove || updated.childQuote !== moment.childQuote || updated.domain !== moment.domain
    || JSON.stringify(updated.topics) !== JSON.stringify(moment.topics) || updated.reviewEligible !== moment.reviewEligible;
  db.updatedAt = now;
  if (!invalidatesEvidence) return { state, db: normalizeLocalStudentDb(db) };
  // Legacy aggregate caches have no per-moment provenance; invalidate them conservatively.
  const model = createInitialStudentModel(state.profile, studentId);
  const observations = state.studentModel.engagement?.offlineObservations;
  if (Array.isArray(observations)) model.engagement.offlineObservations = structuredClone(observations);
  db.studentModels[studentId] = model;
  db.events = db.events.filter((item) => item.studentId !== studentId);
  db.sessions = db.sessions.map((session) => session.studentId === studentId
    ? { ...session, summary: null, turnCount: db.growthMoments.filter((item) => item.sessionId === session.id && item.studentId === studentId).length }
    : session);
  db.updatedAt = now;
  const nextState = idleState(state.profile, state.family, model);
  return { state: nextState, db: normalizeLocalStudentDb(db) };
}
