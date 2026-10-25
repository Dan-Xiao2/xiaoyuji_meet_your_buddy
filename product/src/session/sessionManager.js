import { mayArchiveMoment } from "../services/safety.js";
import { isInteractionControl } from "../services/conversationIntent.js";

export function createIdleSession() {
  return {
    status: "idle",
    id: null,
    startedAt: null,
    endedAt: null,
    turnCount: 0
  };
}

export function createActiveSession(studentId, now = new Date()) {
  const startedAt = toIso(now);
  return {
    status: "active",
    id: createSessionId(),
    studentId: studentId || "local-demo-student",
    startedAt,
    plannedEndAt: null,
    durationMinutes: null,
    endedAt: null,
    turnCount: 0
  };
}

export function getSessionTimeState(session, now = new Date()) {
  const startedAt = new Date(session?.startedAt || now).getTime();
  const currentTime = new Date(now).getTime();
  const elapsedMs = Math.max(0, currentTime - startedAt);

  return {
    durationMinutes: null,
    plannedEndAt: null,
    elapsedMs,
    elapsedMinutes: Math.floor(elapsedMs / 60_000),
    expired: false
  };
}

export function incrementSessionTurn(session) {
  if (session?.status !== "active") return session;
  return { ...session, turnCount: (session.turnCount || 0) + 1 };
}

export function endActiveSession(session, moments = [], now = new Date()) {
  if (!session?.id) return { session: createIdleSession(), summary: null };
  const sessionMoments = moments
    .filter((item) => item.sessionId === session.id)
    .sort((a, b) => new Date(a.observedAt || a.createdAt) - new Date(b.observedAt || b.createdAt));
  const summary = createSessionSummary(sessionMoments);

  return {
    session: {
      ...session,
      status: "ended",
      endedAt: toIso(now),
      turnCount: sessionMoments.length
    },
    summary
  };
}

export function createSessionSummary(moments = []) {
  moments = moments.filter(mayArchiveMoment);
  const childMoments = moments.filter(
    (item) => item.sourceType !== "parent_note" && item.speakerRole !== "mother" && item.speakerRole !== "father" && item.reviewEligible !== false && !isInteractionControl(item.childQuote || item.childText)
  );
  if (!childMoments.length) {
    return {
      title: moments.length ? "这次记录了家人的补充" : "这次还没有留下成长片段",
      standoutQuote: "",
      topics: [],
      domains: [],
      parentPrompt: moments.length ? "家人的补充已保存，不会当成孩子原话。" : "可以等孩子下次主动想说时再开始。",
      momentIds: moments.map((item) => item.id)
    };
  }

  const topics = rankValues(childMoments.flatMap((item) => item.topics || [])).slice(0, 4);
  const domains = rankValues(childMoments.flatMap((item) => item.domains || [item.domain])).slice(0, 4);
  const standout = [...childMoments]
    .filter((item) => item.childQuote)
    .sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || b.childQuote.length - a.childQuote.length)[0];
  const topicText = topics.length ? topics.join("、") : "自己的想法";

  return {
    title: `今天聊到了${topicText}`,
    standoutQuote: standout?.childQuote || "",
    topics,
    domains,
    parentPrompt: standout?.childQuote
      ? `可以接着问：你刚才说“${shortText(standout.childQuote, 34)}”，后来你又想到什么？`
      : "可以请孩子讲讲刚才最想记住的部分。",
    momentIds: moments.map((item) => item.id)
  };
}

function rankValues(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh-CN"))
    .map(([value]) => value);
}

function createSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `session_${crypto.randomUUID()}`;
  return `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function shortText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}
