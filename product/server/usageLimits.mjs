// Daily usage limits per family, so a leaked access code or a client bug cannot run up the provider
// bill (docs/deployment-cn.md). Counts only: never what was said. Counters live in memory and start
// again at midnight (China time) or when the server restarts; they are a safety net, not billing.
// Requests with no family (this computer, no access codes) are not limited.
const DEFAULTS = {
  replies: 300,        // /api/tutor/quick and /quick/stream
  extractions: 300,    // /api/tutor (background growth extraction)
  speech: 600,         // /api/speech and /speech/stream
  transcriptions: 300, // /api/transcribe
  drawings: 100,       // /api/whiteboard/route and /plan
  images: 20,          // /api/whiteboard/image
  asrSeconds: 3600,    // realtime recognition audio
  asrConnections: 2    // realtime recognition connections open at once
};
const ENV = { replies: "USAGE_DAILY_REPLIES", extractions: "USAGE_DAILY_EXTRACTIONS", speech: "USAGE_DAILY_SPEECH",
  transcriptions: "USAGE_DAILY_TRANSCRIPTIONS", drawings: "USAGE_DAILY_DRAWINGS", images: "USAGE_DAILY_IMAGES",
  asrSeconds: "USAGE_DAILY_ASR_SECONDS", asrConnections: "USAGE_ASR_CONNECTIONS" };

export function usageLimitsFromEnv(env = process.env) {
  const limits = { ...DEFAULTS };
  for (const [kind, name] of Object.entries(ENV)) {
    const value = Number(env[name]);
    if (env[name] !== undefined && env[name] !== "" && Number.isFinite(value) && value >= 0) limits[kind] = Math.floor(value);
  }
  return limits;
}

const chinaDay = time => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(time);

// onDayEnd(day, family, counts): called when a family's day rolls over, for a counts-only log line.
export function createUsageLimits({ limits = DEFAULTS, now = () => Date.now(), onDayEnd = () => {} } = {}) {
  const families = new Map();
  const counts = family => {
    const day = chinaDay(now());
    let entry = families.get(family);
    // A new day keeps the connections still open across midnight.
    if (entry && entry.day !== day) { onDayEnd(entry.day, family, { ...entry.used }); entry = { day, used: {}, open: entry.open }; families.set(family, entry); }
    if (!entry) { entry = { day, used: {}, open: 0 }; families.set(family, entry); }
    return entry;
  };
  return {
    limits,
    // Spends one request (or `amount`) if the family is under its limit. Returns whether it may go ahead.
    take(family, kind, amount = 1) {
      if (!family) return true;
      const entry = counts(family);
      const used = entry.used[kind] || 0;
      if (used + amount > limits[kind]) return false;
      entry.used[kind] = used + amount;
      return true;
    },
    // A realtime recognition connection: null when the family has too many open or no audio left
    // today; otherwise { audio(bytes) → whether more audio is allowed, release() }.
    openRecognition(family) {
      if (!family) return { audio: () => true, release() {} };
      const entry = counts(family);
      if (entry.open >= limits.asrConnections || (entry.used.asrSeconds || 0) >= limits.asrSeconds) return null;
      entry.open++;
      let released = false;
      return {
        audio: bytes => { const current = counts(family); current.used.asrSeconds = (current.used.asrSeconds || 0) + bytes / 32000;
          return current.used.asrSeconds <= limits.asrSeconds; },
        release() { if (released) return; released = true; const current = families.get(family); if (current) current.open = Math.max(0, current.open - 1); }
      };
    },
    // Today's counts per family, rounded, for the shutdown log.
    snapshot() {
      return Object.fromEntries([...families].map(([family, entry]) => [family,
        Object.fromEntries(Object.entries(entry.used).map(([kind, value]) => [kind, Math.round(value)]))]));
    }
  };
}
