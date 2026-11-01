import { createServer } from "node:http";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createVoiceLab } from "./voiceLab.mjs";
import { loadLocalEnv } from "./env.mjs";
import { createQuickTutorReplyWithQwen, createTutorTurnWithQwen } from "./qwenTutor.mjs";
import { getSpeechStatus, synthesizeSpeech, transcribeAudio } from "./qwenSpeech.mjs";
import { openSpeechStream } from "./speechStream.mjs";
import { planDrawingWithQwen } from "./drawingPlanner.mjs";
import { attachRealtimeAsr, realtimeAsrConfig } from "./realtimeAsr.mjs";
import { routeOpenDrawing, generateOpenDrawing } from "./openDrawing.mjs";
import { createTutorContext, tutorEnrichmentResult } from "../src/services/tutorContext.js";

const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
loadLocalEnv(root);

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const limits = {
  drawingRoute: 40_000,
  drawingImage: 1_700_000,
  drawingPlan: 128_000,
  transcription: 16_000_000,
  speech: 32_000,
  tutor: 2_000_000
};
const publicPrefixes = [
  "/src/", "/assets/", "/design-drafts/",
  "/node_modules/motion/", "/node_modules/roughjs/", "/node_modules/konva/", "/node_modules/lucide/"
];
const publicFiles = new Set(["/index.html", "/voice-lab.html", "/docs/architecture/xiaoyuji-runtime.architecture.html"]);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8"
};

const voiceLab = createVoiceLab();
let imageRequests = 0;
export const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (response.destroyed || response.headersSent) {
      if (!response.destroyed) response.destroy();
      return;
    }
    sendRequestError(response, error);
  });
});

async function handleRequest(request, response) {
  const pathname = requestUrl(request).pathname;

  if (request.method === "POST" && pathname.startsWith("/api/") && !isSameOrigin(request)) {
    throw new RequestError(403, "forbidden");
  }

  if (pathname.startsWith("/api/voice-lab/")) {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) throw new RequestError(403, "local-lab-only");
    if (request.method === "GET" && pathname === "/api/voice-lab/status") return sendJson(response, 200, voiceLab.status());
    if (request.method !== "POST" || !["/api/voice-lab/start", "/api/voice-lab/stop"].includes(pathname)) throw new RequestError(404, "not-found");
    const body = await readJson(request, 2048);
    const result = await (pathname.endsWith("/start") ? voiceLab.start(body) : voiceLab.stop(body));
    return sendJson(response, result.status, result.data);
  }

  if (request.method === "POST" && ["/api/whiteboard/route", "/api/whiteboard/image"].includes(pathname)) {
    const image = pathname.endsWith("/image");
    if (image && imageRequests >= 1) throw new RequestError(429, "busy");
    const abort = new AbortController();
    response.once("close", () => abort.abort());
    if (image) imageRequests++;
    try {
      const body = await readJson(request, image ? limits.drawingImage : limits.drawingRoute);
      requireString(image ? body.instruction : body.input, image ? "instruction" : "input", 4000);
      const result = await (image ? generateOpenDrawing : routeOpenDrawing)(body, { signal: abort.signal });
      if (!response.destroyed) sendJson(response, 200, result);
    } finally {
      abort.abort();
      if (image) imageRequests--;
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/whiteboard/plan") {
    const abort = new AbortController();
    response.once("close", () => abort.abort());
    try {
      const body = await readJson(request, limits.drawingPlan);
      requireString(body.input, "input", 4000);
      requireObject(body.board, "board");
      const result = await planDrawingWithQwen(body, { signal: abort.signal });
      if (!response.destroyed) sendJson(response, 200, result);
    } finally {
      abort.abort();
    }
    return;
  }

  if (request.method === "GET" && pathname === "/api/voice-status") {
    const speech = getSpeechStatus();
    sendJson(response, 200, {
      ...speech,
      realtimeTranscription: realtimeAsrConfig().enabled,
      cloudTranscription: speech.asr.configured,
      model: speech.asr.model,
      message: speech.asr.configured ? `已连接 ${speech.asr.provider} 语音转文字` : "云端语音转文字尚未配置，将使用浏览器能力降级。"
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/transcribe") {
    const body = await readJson(request, limits.transcription);
    requireString(body.audioBase64, "audioBase64", limits.transcription);
    requireString(body.mimeType, "mimeType", 100);
    const result = await transcribeAudio(body);
    sendJson(response, result.ok ? 200 : result.status, result);
    return;
  }

  if (request.method === "POST" && pathname === "/api/speech/stream") {
    const abort = new AbortController();
    response.once("close", () => abort.abort());
    try {
      const body = await readJson(request, limits.speech);
      requireString(body.text, "text", 2000);
      const startedAt = Date.now();
      const chunks = await openSpeechStream(body.text, abort.signal);
      const first = await chunks.next();
      if (first.done) throw new Error("Empty speech");
      response.writeHead(200, {
        "Content-Type": "audio/pcm", "Cache-Control": "no-store", "X-Accel-Buffering": "no",
        "X-Audio-Sample-Rate": "24000", "X-Voice-Latency-Ms": String(Date.now() - startedAt),
        "X-Content-Type-Options": "nosniff"
      });
      async function* audio() { try { yield first.value; yield* chunks; } finally { await chunks.return(); } }
      await pipeline(Readable.from(audio()), response, { signal: abort.signal });
    } finally {
      abort.abort();
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/speech") {
    const body = await readJson(request, limits.speech);
    requireString(body.text, "text", 2000);
    const result = await synthesizeSpeech(body.text);
    if (!result.ok) {
      sendJson(response, result.status, result);
      return;
    }
    response.writeHead(200, {
      "Content-Type": result.contentType,
      "Content-Length": result.audio.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Voice-Provider": result.provider,
      "X-Voice-Model": result.model,
      "X-Voice-Latency-Ms": String(result.latencyMs || 0)
    });
    response.end(result.audio);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tutor") {
    const abort = new AbortController();
    response.once("close", () => abort.abort());
    try {
      const body = await readJson(request, limits.tutor);
      requireString(body.input, "input", 4000);
      requireObject(body.state, "state");
      // Background extraction cannot assess a lesson or return a replacement app state.
      const context = { ...createTutorContext(body.state), activeLesson: null };
      const nextState = await createTutorTurnWithQwen(body.input, context, { signal: abort.signal, spokenReply: body.spokenReply });
      if (!response.destroyed) sendJson(response, 200, tutorEnrichmentResult(nextState));
    } finally {
      abort.abort();
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/tutor/quick") {
    const abort = new AbortController();
    response.once("close", () => abort.abort());
    try {
      const body = await readJson(request, limits.tutor);
      requireString(body.input, "input", 4000);
      requireObject(body.state, "state");
      const result = await createQuickTutorReplyWithQwen(body.input, createTutorContext(body.state), body.fallbackReply || "", { signal: abort.signal });
      if (!response.destroyed) sendJson(response, 200, result);
    } finally {
      abort.abort();
    }
    return;
  }

  await servePublicFile(request, response, pathname);
}

attachRealtimeAsr(server);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => console.log(`小宇记 MVP is running at http://${host}:${port}`));
}

function requestUrl(request) {
  try {
    return new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  } catch {
    throw new RequestError(400, "invalid-url");
  }
}

function isSameOrigin(request) {
  try {
    return new URL(request.headers.origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function readJson(request, limit) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new RequestError(415, "json-required");
  }
  const declared = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declared) && declared > limit) throw new RequestError(413, "request-too-large");
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new RequestError(413, "request-too-large");
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "invalid-json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestError(400, "invalid-json");
  return parsed;
}

function requireString(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new RequestError(400, `invalid-${field}`);
  }
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, `invalid-${field}`);
  }
}

async function servePublicFile(request, response, rawPathname) {
  if (!["GET", "HEAD"].includes(request.method)) throw new RequestError(405, "method-not-allowed");
  let pathname;
  try {
    pathname = decodeURIComponent(rawPathname === "/" ? "/index.html" : rawPathname);
  } catch {
    throw new RequestError(400, "invalid-url");
  }
  const allowed = publicFiles.has(pathname) || publicPrefixes.some((prefix) => pathname.startsWith(prefix));
  if (!allowed || pathname.split("/").some((part) => part.startsWith("."))) throw new RequestError(404, "not-found");

  const filePath = normalize(join(root, pathname));
  const pathFromRoot = relative(root, filePath);
  if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new RequestError(404, "not-found");
  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mime[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin"
    });
    response.end(request.method === "HEAD" ? undefined : file);
  } catch {
    throw new RequestError(404, "not-found");
  }
}

class RequestError extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
    this.reason = reason;
  }
}

function sendRequestError(response, error) {
  const status = error instanceof RequestError ? error.status : 500;
  const reason = error instanceof RequestError ? error.reason : "server-error";
  sendJson(response, status, { ok: false, reason });
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}
