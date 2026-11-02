import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialState } from "../src/data/studentModel.js";
import { createQuickTutorReplyWithQwen, quickModel } from "../server/qwenTutor.mjs";
import { generateOpenDrawing, imageConfig } from "../server/openDrawing.mjs";
import { loadLocalEnv } from "../server/env.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = new Set(process.argv.slice(2));
if (!args.has("--live") || !args.has("--allow-paid-api")) {
  throw new Error("Real provider calls require both --live and --allow-paid-api.");
}
loadLocalEnv(root);
if (!process.env.QWEN_API_KEY || process.env.QWEN_API_KEY.startsWith("replace_me")) {
  throw new Error("QWEN_API_KEY is required for the real-model benchmark.");
}

const repeats = integerArg("--repeats", 1, 1, 5);
const maxTurns = integerArg("--max-turns", 100, 1, 100);
const includeImages = args.has("--include-images");
const selectedIds = process.argv.find(value => value.startsWith("--scenarios="))?.slice("--scenarios=".length).split(",");
const allCases = await readJson(resolve(root, "benchmarks/fixtures/conversation-quality.json"));
if (selectedIds?.some(id => !allCases.some(item => item.id === id))) throw new Error("Unknown conversation scenario");
const conversationCases = selectedIds ? allCases.filter(item => selectedIds.includes(item.id)) : allCases;
const textCallLimit = integerArg("--max-text-calls", 100, 1, 100);
if (includeImages && process.argv.some(value => value.startsWith("--max-text-calls="))) {
  throw new Error("Use the text-call budget only in a text-only run.");
}
let textApiAttempts = 0;
const providerFetch = globalThis.fetch;
if (!includeImages) globalThis.fetch = (...args) => {
  if (textApiAttempts >= textCallLimit) throw new Error("Text API call budget exhausted");
  textApiAttempts++;
  return providerFetch(...args);
};
const drawingCases = await readJson(resolve(root, "benchmarks/fixtures/drawing-edit-quality.json"));
const pricing = await loadPricing();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportFolder = resolve(root, "reports/real-model", stamp);
const imageFolder = resolve(reportFolder, "images");
await mkdir(imageFolder, { recursive: true });

const rows = [];
for (let repeat = 0; repeat < repeats; repeat += 1) {
  for (const scenario of conversationCases) {
    const state = createInitialState();
    state.profile = { ...state.profile, name: "虚构测试孩子", ageBand: "4-5", configured: true, consent: true };
    state.activeSpeaker = { role: "child", name: "虚构测试孩子" };
    const previousQuestions = [];
    for (let turnIndex = 0; turnIndex < Math.min(scenario.turns.length, maxTurns); turnIndex += 1) {
      const turn = scenario.turns[turnIndex];
      state.messages.push({ role: "child", speakerRole: "child", speakerName: "虚构测试孩子", text: turn.input });
      const started = performance.now();
      const result = await createQuickTutorReplyWithQwen(turn.input, state, "我听到了，我们继续说。", {});
      const latencyMs = Math.round(performance.now() - started);
      const questions = extractQuestions(result.reply);
      const repeatedQuestions = questions.filter(question => previousQuestions.some(previous => similarity(question, previous) >= 0.72));
      previousQuestions.push(...questions);
      const topic = scoreTopic(result.reply, turn);
      const tokenUsage = result.llmStatus?.tokenUsage || null;
      rows.push({
        kind: "conversation",
        scenarioId: scenario.id,
        description: scenario.description,
        repeat,
        turn: turnIndex + 1,
        input: turn.input,
        reply: result.reply,
        model: result.llmStatus?.model || null,
        providerUsed: result.llmStatus?.used === true,
        expectedProvider: turn.expectedProvider || "qwen",
        fallback: result.llmStatus?.fallback === true,
        failureReason: result.llmStatus?.message || null,
        latencyMs,
        tokenUsage,
        estimatedCost: estimateTextCost(tokenUsage, pricing),
        topicPassed: topic.passed,
        topicEvidence: topic,
        questionCount: questions.length,
        repeatedQuestionCount: repeatedQuestions.length,
        repeatedQuestions,
        humanReview: "pending",
        reviewerNotes: ""
      });
      state.messages.push({ role: "tutor", text: result.reply });
    }
  }
}

const drawingRows = [];
if (includeImages) {
  const env = { ...process.env, IMAGE_DRAWING_ENABLED: "true" };
  if (!imageConfig(env).enabled) throw new Error("Image generation is not configured for this account and region.");
  for (const scenario of drawingCases) {
    const create = await runDrawingStep(scenario, "create", scenario.create, undefined, env);
    drawingRows.push(create.row);
    if (!create.result.ok) continue;
    const edit = await runDrawingStep(scenario, "edit", scenario.edit, create.result.image, env);
    drawingRows.push(edit.row);
  }
}

const modelRows = rows.filter(row => row.expectedProvider === "qwen");
const allLatencies = modelRows.map(row => row.latencyMs);
const questionCount = sum(rows.map(row => row.questionCount));
const repeatedQuestionCount = sum(rows.map(row => row.repeatedQuestionCount));
const textCost = sumKnown(rows.map(row => row.estimatedCost));
const imageCost = sumKnown(drawingRows.map(row => row.estimatedCost));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: "live-provider",
  configuration: {
    provider: "qwen",
    // The spoken quick reply has its own model (QWEN_QUICK_MODEL); QWEN_MODEL is background enrichment.
    requestedTextModel: quickModel(),
    requestedImageModel: includeImages ? imageConfig({ ...process.env, IMAGE_DRAWING_ENABLED: "true" }).model : null,
    requestedImageReviewModel: includeImages ? imageConfig({ ...process.env, IMAGE_DRAWING_ENABLED: "true" }).reviewModel : null,
    repeats,
    maxTurnsPerScenario: maxTurns,
    includesImages: includeImages,
    textCallLimit: includeImages ? null : textCallLimit,
    pricing
  },
  summary: {
    conversationTurns: rows.length,
    textApiAttempts: includeImages ? null : textApiAttempts,
    modelTurns: modelRows.length,
    localControlTurns: rows.length - modelRows.length,
    providerFallbacks: modelRows.filter(row => row.fallback || !row.providerUsed).length,
    unexpectedProviderCalls: rows.filter(row => row.expectedProvider === "local" && row.providerUsed).length,
    topicFollowingRate: rate(rows.filter(row => row.topicPassed).length, rows.length),
    repeatedQuestionRate: rate(repeatedQuestionCount, questionCount),
    latencyMs: { p50: percentile(allLatencies, 0.5), p95: percentile(allLatencies, 0.95), max: Math.max(0, ...allLatencies) },
    tokenUsage: totalUsage(rows.map(row => row.tokenUsage)),
    drawingEditSuccessRate: includeImages
      ? rate(drawingRows.filter(row => row.operation === "edit" && row.ok).length, drawingRows.filter(row => row.operation === "edit").length)
      : null,
    estimatedCost: textCost === null && imageCost === null ? null : round((textCost || 0) + (imageCost || 0)),
    currency: pricing.currency,
    costCoverage: costCoverage(pricing, includeImages)
  },
  conversationRows: rows,
  drawingRows,
  humanReview: {
    status: "required",
    instructions: "Review every reply and generated image before using this report for a release decision."
  },
  limitations: [
    "Fixed synthetic prompts are regression indicators, not evidence of child usability.",
    "Reply latency is end-to-end non-streaming text latency, not first-audio latency.",
    "Topic matching is deterministic keyword/regex scoring and requires human review.",
    "Image success reflects the current automated reviewer and still requires visual inspection.",
    "Estimated cost is null or partial unless current account pricing is configured."
  ]
};
const target = resolve(reportFolder, "report.json");
await writeFile(target, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: target, summary: report.summary }, null, 2));
if (report.summary.providerFallbacks || report.summary.unexpectedProviderCalls || report.summary.topicFollowingRate < 0.8 || report.summary.repeatedQuestionRate > 0.2 ||
  (includeImages && report.summary.drawingEditSuccessRate < 0.8)) process.exitCode = 1;

async function runDrawingStep(scenario, operation, instruction, image, env) {
  const started = performance.now();
  const result = await generateOpenDrawing({ operation, instruction, image }, { env });
  const latencyMs = Math.round(performance.now() - started);
  const file = result.ok ? `${scenario.id}-${operation}.png` : null;
  if (file) await writeFile(resolve(imageFolder, file), Buffer.from(result.image.split(",")[1], "base64"));
  const reviewCost = estimateReviewCost(result.reviewTokenUsage, pricing);
  const generationCost = finiteOrNull(pricing.imagePerCall);
  return {
    result,
    row: {
      kind: "drawing",
      scenarioId: scenario.id,
      operation,
      instruction,
      ok: result.ok,
      reason: result.reason || null,
      model: result.model || imageConfig(env).model,
      reviewModel: result.reviewModel || imageConfig(env).reviewModel,
      latencyMs,
      reviewTokenUsage: result.reviewTokenUsage || null,
      estimatedCost: generationCost === null || reviewCost === null ? null : round(generationCost + reviewCost),
      file,
      humanReview: "pending",
      reviewerNotes: ""
    }
  };
}

async function loadPricing() {
  const pricingArg = process.argv.find(value => value.startsWith("--pricing="));
  const filePricing = pricingArg ? await readJson(resolve(process.cwd(), pricingArg.slice("--pricing=".length))) : {};
  return {
    currency: process.env.BENCHMARK_CURRENCY || filePricing.currency || "CNY",
    textInputPerMillion: numberSetting("BENCHMARK_TEXT_INPUT_PER_MILLION", filePricing.textInputPerMillion),
    textOutputPerMillion: numberSetting("BENCHMARK_TEXT_OUTPUT_PER_MILLION", filePricing.textOutputPerMillion),
    imagePerCall: numberSetting("BENCHMARK_IMAGE_PER_CALL", filePricing.imagePerCall),
    imageReviewInputPerMillion: numberSetting("BENCHMARK_IMAGE_REVIEW_INPUT_PER_MILLION", filePricing.imageReviewInputPerMillion),
    imageReviewOutputPerMillion: numberSetting("BENCHMARK_IMAGE_REVIEW_OUTPUT_PER_MILLION", filePricing.imageReviewOutputPerMillion),
    source: pricingArg ? pricingArg.slice("--pricing=".length) : "environment"
  };
}

function scoreTopic(reply, turn) {
  const required = (turn.mustAny || []).map(pattern => ({ pattern, matched: new RegExp(pattern, "i").test(reply) }));
  const forbidden = (turn.mustNot || []).map(pattern => ({ pattern, matched: new RegExp(pattern, "i").test(reply) }));
  return { passed: (!required.length || required.some(item => item.matched)) && forbidden.every(item => !item.matched), required, forbidden };
}

function extractQuestions(text) {
  return String(text || "").split(/[。！!\n]+/).filter(part => /[？?]/.test(part)).map(normalizeText).filter(Boolean);
}

function similarity(a, b) {
  const left = bigrams(a); const right = bigrams(b);
  if (!left.size || !right.size) return a === b ? 1 : 0;
  const intersection = [...left].filter(item => right.has(item)).length;
  return intersection / (left.size + right.size - intersection);
}

function bigrams(text) {
  const value = normalizeText(text); const result = new Set();
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
  return result;
}

function normalizeText(text) { return String(text || "").replace(/[\s，。！？!?、：“”‘’]/g, "").toLowerCase(); }
function estimateTextCost(usage, config) {
  if (!usage || finiteOrNull(config.textInputPerMillion) === null || finiteOrNull(config.textOutputPerMillion) === null) return null;
  return round(usage.inputTokens / 1_000_000 * config.textInputPerMillion + usage.outputTokens / 1_000_000 * config.textOutputPerMillion);
}
function estimateReviewCost(usage, config) {
  if (!usage || finiteOrNull(config.imageReviewInputPerMillion) === null || finiteOrNull(config.imageReviewOutputPerMillion) === null) return null;
  return round(usage.inputTokens / 1_000_000 * config.imageReviewInputPerMillion + usage.outputTokens / 1_000_000 * config.imageReviewOutputPerMillion);
}
function costCoverage(config, images) {
  const text = finiteOrNull(config.textInputPerMillion) !== null && finiteOrNull(config.textOutputPerMillion) !== null;
  const image = !images || (finiteOrNull(config.imagePerCall) !== null && finiteOrNull(config.imageReviewInputPerMillion) !== null && finiteOrNull(config.imageReviewOutputPerMillion) !== null);
  return text && image ? "complete-estimate" : text || (images && image) ? "partial-estimate" : "pricing-not-configured";
}
function totalUsage(values) { return values.filter(Boolean).reduce((sum, value) => ({ inputTokens: sum.inputTokens + value.inputTokens, outputTokens: sum.outputTokens + value.outputTokens, totalTokens: sum.totalTokens + value.totalTokens }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 }); }
function percentile(values, quantile) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil((sorted.length - 1) * quantile)]; }
function rate(numerator, denominator) { return denominator ? round(numerator / denominator) : null; }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function sumKnown(values) { const known = values.filter(value => value !== null); return known.length ? round(sum(known)) : null; }
function round(value) { return Math.round(value * 1_000_000) / 1_000_000; }
function finiteOrNull(value) { return Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : null; }
function numberSetting(name, fallback) { return finiteOrNull(process.env[name]) ?? finiteOrNull(fallback); }
function integerArg(name, fallback, min, max) { const raw = process.argv.find(value => value.startsWith(`${name}=`)); if (!raw) return fallback; const value = Number(raw.split("=")[1]); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
