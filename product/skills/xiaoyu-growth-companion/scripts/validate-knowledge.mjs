import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const referencesDir = path.resolve(here, "../references");

const allowedAgeBands = new Set(["0-1", "1-2", "2-3", "3-4", "4-5", "5-6"]);
const allowedDomains = new Set([
  "health_and_independence",
  "language_and_communication",
  "social_and_emotional",
  "science_and_thinking",
  "art_and_expression",
]);
const allowedDeliveryModes = new Set([
  "parent_assisted",
  "shared_device_with_parent",
  "child_voice",
]);
const allowedUsePolicies = new Set([
  "adapt_with_attribution",
  "summarize_and_cite_only",
  "internal_research_only_no_commercial_derivative",
  "historical_context_only",
]);
const forbiddenKeys = new Set(["score", "percentile", "diagnosis", "ranking"]);

const errors = [];

function requireFields(item, fields, label) {
  for (const field of fields) {
    if (item[field] === undefined || item[field] === null || item[field] === "") {
      errors.push(`${label}: missing ${field}`);
    }
  }
}

function requireUnique(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) errors.push(`${label}: duplicate id ${item.id}`);
    seen.add(item.id);
  }
}

function checkAllowedList(values, allowed, label) {
  if (!Array.isArray(values) || values.length === 0) {
    errors.push(`${label}: must be a non-empty array`);
    return;
  }
  for (const value of values) {
    if (!allowed.has(value)) errors.push(`${label}: unsupported value ${value}`);
  }
}

function walkForForbiddenKeys(value, trail = "root") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkForForbiddenKeys(entry, `${trail}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) errors.push(`${trail}: forbidden key ${key}`);
    walkForForbiddenKeys(child, `${trail}.${key}`);
  }
}

async function loadJson(name) {
  const raw = await readFile(path.join(referencesDir, name), "utf8");
  return JSON.parse(raw);
}

const sourceRegistry = await loadJson("source-registry.json");
const knowledgeBase = await loadJson("knowledge-cards.json");
const sources = sourceRegistry.sources ?? [];
const cards = knowledgeBase.cards ?? [];

requireUnique(sources, "source registry");
requireUnique(cards, "knowledge cards");
const sourceIds = new Set(sources.map((source) => source.id));

for (const source of sources) {
  const label = `source ${source.id ?? "unknown"}`;
  requireFields(source, [
    "id",
    "title",
    "publisher",
    "ageBands",
    "domains",
    "evidenceType",
    "license",
    "usePolicy",
    "url",
    "reviewedAt",
    "nextReviewAt",
    "notes",
  ], label);
  checkAllowedList(source.ageBands, allowedAgeBands, `${label}.ageBands`);
  checkAllowedList(source.domains, allowedDomains, `${label}.domains`);
  if (!allowedUsePolicies.has(source.usePolicy)) {
    errors.push(`${label}: unsupported usePolicy ${source.usePolicy}`);
  }
  if (!String(source.url).startsWith("https://")) errors.push(`${label}: URL must use HTTPS`);
  if (Number.isNaN(Date.parse(source.reviewedAt))) errors.push(`${label}: invalid reviewedAt`);
  if (Number.isNaN(Date.parse(source.nextReviewAt))) errors.push(`${label}: invalid nextReviewAt`);
}

for (const card of cards) {
  const label = `card ${card.id ?? "unknown"}`;
  requireFields(card, [
    "id",
    "title",
    "ageBands",
    "deliveryMode",
    "domain",
    "purpose",
    "observeSignals",
    "companionMoves",
    "offlineAction",
    "avoid",
    "sourceIds",
  ], label);
  checkAllowedList(card.ageBands, allowedAgeBands, `${label}.ageBands`);
  if (!allowedDeliveryModes.has(card.deliveryMode)) {
    errors.push(`${label}: unsupported deliveryMode ${card.deliveryMode}`);
  }
  if (!allowedDomains.has(card.domain)) errors.push(`${label}: unsupported domain ${card.domain}`);
  requireFields(card.offlineAction ?? {}, ["title", "materials", "steps", "durationMinutes"], `${label}.offlineAction`);
  if (!Array.isArray(card.offlineAction?.steps) || card.offlineAction.steps.length < 1 || card.offlineAction.steps.length > 3) {
    errors.push(`${label}: offlineAction.steps must contain 1-3 steps`);
  }
  if (!Number.isInteger(card.offlineAction?.durationMinutes) || card.offlineAction.durationMinutes < 1 || card.offlineAction.durationMinutes > 15) {
    errors.push(`${label}: offlineAction.durationMinutes must be an integer from 1 to 15`);
  }
  for (const sourceId of card.sourceIds ?? []) {
    if (!sourceIds.has(sourceId)) errors.push(`${label}: unknown sourceId ${sourceId}`);
  }
}

walkForForbiddenKeys(knowledgeBase, "knowledge-cards.json");

if (errors.length > 0) {
  console.error(`Knowledge validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Knowledge validation passed: ${sources.length} sources, ${cards.length} cards.`);
