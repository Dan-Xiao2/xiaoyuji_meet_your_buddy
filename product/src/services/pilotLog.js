// Family-pilot measurements: per-turn stage timings and failure codes, kept for this browser tab
// (sessionStorage survives a reload during a test) and exported as a file for the team.
// Only allow-listed fields are stored. Never text, audio, names, or anything a child said.
const STORAGE_KEY = "xiaoyuji-pilot-log-v1";
const CODE = /^[a-z0-9-]{1,40}$/;
const FAILURE_STAGES = new Set(["asr-realtime-fallback", "tts-stream-fallback", "tts-cloud-failed", "tts-cloud-mp3"]);

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

export function summarizePilot(entries) {
  const byStage = {};
  for (const entry of entries) (byStage[entry.stage] ||= []).push(entry.latencyMs);
  const stages = Object.fromEntries(Object.entries(byStage).map(([stage, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [stage, { count: sorted.length, p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), max: sorted.at(-1) }];
  }));
  const failures = {};
  for (const entry of entries) {
    if (!FAILURE_STAGES.has(entry.stage)) continue;
    const key = entry.reason ? `${entry.stage}:${entry.reason}` : entry.stage;
    failures[key] = (failures[key] || 0) + 1;
  }
  return { turns: Math.max(0, ...entries.map(entry => entry.turn)), stages, failures };
}

// Coarse device class only: enough to compare phones, not to identify one.
export function describeDevice(userAgent = "", viewport = {}) {
  const ios = /\b(?:iPhone|iPad|iPod)\b.*?OS (\d+)[_.](\d+)/.exec(userAgent);
  const android = /Android (\d+)/.exec(userAgent);
  const platform = ios ? `iOS ${ios[1]}.${ios[2]}` : android ? `Android ${android[1]}` : /Mac OS X/.test(userAgent) ? "macOS" : /Windows/.test(userAgent) ? "Windows" : "other";
  const browser = /CriOS|Chrome\//.test(userAgent) ? "Chrome" : /FxiOS|Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "other";
  const size = value => (Number.isFinite(value) ? Math.round(value) : null);
  return { platform, browser, viewport: { width: size(viewport.width), height: size(viewport.height) } };
}

export function createPilotLog({ storage = null, now = () => Date.now(), maxEntries = 600 } = {}) {
  let entries = [];
  try { entries = JSON.parse(storage?.getItem(STORAGE_KEY) || "[]").filter(entry => CODE.test(entry?.stage)); } catch { entries = []; }
  let turn = Math.max(0, ...entries.map(entry => entry.turn || 0));
  const inTurn = stage => entries.some(entry => entry.turn === turn && entry.stage === stage);
  const save = () => { try { storage?.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* storage full or blocked: keep in memory */ } };
  return {
    record({ stage, latencyMs, serverLatencyMs, reason, audioSeconds } = {}) {
      if (!CODE.test(stage) || !Number.isFinite(Number(latencyMs))) return;
      // Recognition connects when the child STARTS speaking, before the end-point, so a turn cannot
      // begin at the end-point. A new turn opens once the previous reply has started playing, or
      // at a second end-point within one turn (a reply that never played, e.g. speech disabled).
      if (turn === 0 || inTurn("response-start") || (stage === "endpoint" && inTurn("endpoint"))) turn++;
      const entry = { turn, stage, latencyMs: Math.round(Number(latencyMs)), at: now() };
      if (Number(serverLatencyMs) > 0) entry.serverLatencyMs = Math.round(Number(serverLatencyMs));
      if (CODE.test(reason)) entry.reason = reason;
      if (Number.isFinite(audioSeconds)) entry.audioSeconds = Math.round(audioSeconds * 10) / 10;
      entries.push(entry);
      if (entries.length > maxEntries) entries.shift();
      save();
    },
    entries: () => entries.map(entry => ({ ...entry })),
    clear() { entries = []; turn = 0; try { storage?.removeItem(STORAGE_KEY); } catch { /* ignore */ } },
    exportFile({ userAgent, viewport } = {}) {
      const start = entries[0]?.at ?? now();
      return {
        product: "小宇记", kind: "pilot-measurements", schema: 1, exportedAt: new Date(now()).toISOString(),
        contains: "每轮各阶段耗时与失败原因代码；不含录音、文字、姓名或孩子说的话。",
        device: describeDevice(userAgent, viewport),
        summary: summarizePilot(entries),
        // Times relative to the first record, so the file carries no wall-clock schedule.
        entries: entries.map(({ at, ...entry }) => ({ ...entry, atMs: at - start }))
      };
    }
  };
}
