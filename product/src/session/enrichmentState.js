const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const evidenceFields = ["memory", "studentModel", "growthEvidence"];

export function captureEnrichmentBaseline(state) {
  return Object.fromEntries(evidenceFields.map(field => [field, JSON.stringify(state[field])]));
}

// Compare serialized domain snapshots because legacy handlers still mutate in place.
// A conflicting domain stays local; this is not a field-level evidence merge.
export function mergeEnrichmentState(current, enriched, { baseline, onConflict } = {}) {
  if (!isObject(current) || !isObject(enriched)) return current;
  const result = {
    ...current,
    llmStatus: isObject(enriched.llmStatus)
      ? { ...(current.llmStatus || {}), ...enriched.llmStatus }
      : current.llmStatus
  };
  for (const field of evidenceFields) {
    if (!isObject(enriched[field])) continue;
    if (baseline && JSON.stringify(current[field]) !== baseline[field]) {
      onConflict?.(field);
      continue;
    }
    result[field] = enriched[field];
  }
  return result;
}
