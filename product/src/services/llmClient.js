import { createConversationTurn as createTutorTurn } from "./tutorEngine.js";
import { validIllustrationScene } from "../whiteboard/illustrationPlan.js";
import { safeConversationMessages, checkTutorSafetyOutput } from "./safety.js";
import { createTutorRequest, tutorEnrichmentResult } from "./tutorContext.js";

export async function callDrawingPlanApi({ input, state }, { signal } = {}) {
  if (window.location.protocol === "file:") return null;
  const board = validIllustrationScene(state.board) ? state.board : { type: "blank" };
  try {
    const response = await fetch("/api/whiteboard/plan", {
      method: "POST", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(7500)]) : AbortSignal.timeout(7500),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, board, context: safeConversationMessages(state.messages).slice(-4).map(m => ({ role: m.role, text: m.text })) })
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (!checkTutorSafetyOutput(result.plan).ok) return null;
    const blankClarification = result.plan?.changed === false && board.type === "blank" && result.plan.board?.type === "blank";
    if (result.plan && ((!validIllustrationScene(result.plan.board) && !blankClarification) ||
      result.sourceRevision !== (board.scene?.revision ?? null) ||
      (board.scene && result.plan.board.scene.id !== board.scene.id) ||
      typeof result.plan.reply !== "string" || (!blankClarification && result.plan.reply !== result.plan.board.scene.steps.map(step => step.text).join("")))) return null;
    return result;
  } catch { return null; }
}

export async function callTutorApi(payload, { signal } = {}) {
  if (window.location.protocol === "file:") {
    return createTutorTurn(payload.input, payload.state);
  }

  try {
    const response = await fetch("/api/tutor", {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTutorRequest(payload))
    });

    if (!response.ok) throw new Error("Tutor API failed");
    return tutorEnrichmentResult(await response.json(), payload.state.memory);
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn("Using local tutor engine fallback", error);
    return createTutorTurn(payload.input, payload.state);
  }
}

// Sentence by sentence: onSentence(text) is called for each checked sentence as it arrives, so
// speech can start before the reply is complete. Resolves like callQuickTutorApi. If the stream
// fails before any sentence, falls back to the whole-reply request; after some sentences, the reply
// is what was already said (it cannot be taken back).
async function streamQuickTutorApi(payload, { signal, onSentence }) {
  const startedAt = window.performance.now();
  const sentences = [];
  try {
    const response = await fetch("/api/tutor/quick/stream", {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTutorRequest(payload))
    });
    if (!response.ok || !response.body) throw new Error("Quick tutor stream failed");
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "", done = null;
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += value;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const item = JSON.parse(line);
        if (item.type === "sentence" && typeof item.text === "string" && item.text) {
          sentences.push(item.text);
          onSentence(item.text);
        } else if (item.type === "done") done = item;
      }
    }
    if (!done) throw new Error("Quick tutor stream ended early");
    return { reply: done.reply || sentences.join(""), llmStatus: done.llmStatus, streamed: true,
      clientLatencyMs: Math.round(window.performance.now() - startedAt) };
  } catch (error) {
    if (signal?.aborted) return { reply: "", cancelled: true };
    if (!sentences.length) return callQuickTutorApi(payload, { signal });
    console.warn("Quick reply stream ended early", error);
    return { reply: sentences.join(""), streamed: true, llmStatus: { provider: "qwen", used: true, fallback: false, partial: true },
      clientLatencyMs: Math.round(window.performance.now() - startedAt) };
  }
}

export async function callQuickTutorApi(payload, { signal, onSentence } = {}) {
  if (onSentence && window.location.protocol !== "file:") return streamQuickTutorApi(payload, { signal, onSentence });
  if (window.location.protocol === "file:") {
    return {
      reply: payload.fallbackReply || "我听到了。我们一起想一想。",
      llmStatus: { provider: "local", used: false, fallback: true, latencyMs: 0 }
    };
  }

  const startedAt = window.performance.now();
  try {
    const response = await fetch("/api/tutor/quick", {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTutorRequest(payload))
    });
    if (!response.ok) throw new Error("Quick tutor API failed");
    const result = await response.json();
    return {
      ...result,
      clientLatencyMs: Math.round(window.performance.now() - startedAt)
    };
  } catch (error) {
    if (signal?.aborted) return { reply: "", cancelled: true };
    console.warn("Using local quick reply fallback", error);
    return {
      reply: payload.fallbackReply || "我听到了。我们一起想一想。",
      llmStatus: { provider: "local", used: false, fallback: true, latencyMs: 0 },
      clientLatencyMs: Math.round(window.performance.now() - startedAt)
    };
  }
}
