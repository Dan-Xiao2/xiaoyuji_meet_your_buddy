// Legacy wire key llmStatus now contains diagnostics only, never task/UI progress.
const fields = ["provider", "model", "used", "fallback", "quickUsed", "quickLatencyMs", "latencyMs", "totalLatencyMs",
  "tokenUsage", "knowledgeCardIds", "knowledgeIntent", "groundingFallback", "drawingClaimFallback"];

export function selectModelDiagnostics(value) {
  if (!value) return value;
  return Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, structuredClone(value[key])]));
}
