// Bounded, page-memory diagnostics. No content, storage, network, or UI dependencies.
const eventTypes = new Set([
  "conversation.started", "conversation.cancelled", "conversation.requested", "conversation.received",
  "conversation.rejected", "conversation.result-ready", "conversation.accepted", "conversation.failed",
  "drawing.requested", "drawing.received", "drawing.cancelled", "drawing.rejected", "drawing.accepted", "drawing.failed",
  "media.capture-started", "media.capture-processing", "media.capture-completed", "media.capture-failed",
  "media.play-requested", "media.play-started", "media.play-ended", "media.play-failed", "media.play-skipped",
  "media.cancelled", "media.barge-in", "media.callback-rejected", "media.listen-scheduled", "media.listen-skipped", "interaction.stopped"
]);
const phases = new Set(["idle", "started", "pending", "quick", "enrichment", "result-ready", "complete", "protected",
  "cancelled", "rejected", "failed", "route", "plan", "image", "capturing", "processing", "preparing", "playing"]);
const reasons = new Set(["stale-turn", "duplicate-run", "session-changed", "session-inactive", "source-changed",
  "reply-changed", "missing-target", "pending-rejected", "quick-rejected", "commit-rejected", "base-changed",
  "stale-task", "stale-media", "settled", "disabled", "not-visible", "pending", "input-busy", "output-busy",
  "muted", "empty", "request-failed", "publish-failed", "stopped", "messages-changed", "invalid-submission", "duplicate-result"]);
const idKeys = ["sessionId", "turnId", "taskId", "childMessageId", "replyMessageId"];
const numberKeys = ["revision", "baseRevision", "captureRevision", "playbackRevision", "delayMs", "segmentIndex"];

function project(value = {}) {
  const result = {};
  for (const key of idKeys) if (typeof value[key] === "string" && /^[\w:-]{1,120}$/.test(value[key])) result[key] = value[key];
  for (const key of numberKeys) if (Number.isFinite(value[key])) result[key] = value[key];
  for (const key of ["phase", "stage", "input", "output"]) if (phases.has(value[key])) result[key] = value[key];
  for (const key of ["autoListen", "scheduled", "replyAccepted", "awaitingReply"]) if (typeof value[key] === "boolean") result[key] = value[key];
  if (["capture", "playback"].includes(value.failure)) result.failure = value.failure;
  if (reasons.has(value.reason)) result.reason = value.reason;
  return result;
}

export function createRuntimeDiagnostics({ now = () => performance.now() } = {}) {
  const events = [], readers = new Map();
  let sequence = 0;
  return {
    record(type, details) {
      if (!eventTypes.has(type)) return;
      events.push({ sequence: ++sequence, atMs: Math.round(now()), type, ...project(details) });
      if (events.length > 256) events.shift();
    },
    register(name, read) {
      if (!["conversation", "drawingPlan", "drawingImage", "media"].includes(name)) throw new Error("Unknown runtime owner");
      readers.set(name, read);
    },
    read() {
      return { events: events.map(event => ({ ...event })), dropped: sequence - events.length,
        snapshots: Object.fromEntries([...readers].map(([name, read]) => [name, project(read())])) };
    }
  };
}

// Importable by local diagnostics/tests. This does not put a writable controller on window.
export const runtimeDiagnostics = createRuntimeDiagnostics();
