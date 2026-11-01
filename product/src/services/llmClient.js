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

export async function callQuickTutorApi(payload, { signal } = {}) {
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
