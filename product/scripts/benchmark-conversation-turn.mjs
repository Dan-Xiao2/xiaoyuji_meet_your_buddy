import { createQuickTutorReplyWithQwen, streamQuickTutorReplyWithQwen } from "../server/qwenTutor.mjs";

// Collect the same server generator used by /api/tutor/quick/stream. Times are text
// release times at this process, not browser arrival, playback, or first-audio times.
export async function collectConversationTurn(input, state, { mode = "quick", signal } = {}) {
  if (!["quick", "stream"].includes(mode)) throw new Error("Unknown reply mode");
  const started = performance.now();
  const fallback = "我听到了，我们继续说。";
  if (mode === "quick") {
    const result = await createQuickTutorReplyWithQwen(input, state, fallback, { signal });
    return { ...result, latencyMs: Math.round(performance.now() - started), firstTextMs: null, releasedSegments: [] };
  }
  const releasedSegments = [];
  let llmStatus = null;
  for await (const event of streamQuickTutorReplyWithQwen(input, state, fallback, { signal })) {
    if (event.type === "sentence") releasedSegments.push({ text: event.text, elapsedMs: Math.round(performance.now() - started) });
    if (event.type === "done") llmStatus = event.llmStatus;
  }
  if (!llmStatus) throw new Error("Stream ended without completion status");
  return {
    reply: releasedSegments.map(item => item.text).join(""),
    llmStatus,
    latencyMs: Math.round(performance.now() - started),
    firstTextMs: releasedSegments[0]?.elapsedMs ?? null,
    releasedSegments
  };
}
