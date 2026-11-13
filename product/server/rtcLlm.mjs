import { timingSafeEqual } from "node:crypto";
import { streamQuickTutorReplyWithQwen } from "./qwenTutor.mjs";
import { createTutorContext } from "../src/services/tutorContext.js";

// Xiaoyu's reply for Alibaba Cloud's AI real-time interaction (RTC voice agent, verification only).
// Its workflow calls a "self-developed LLM" the OpenAI way: POST {base}/chat/completions with the
// conversation (at most 20 messages, the child's latest words last), stream true, and extendData.
// The reply is the same checked quick reply the page uses (safety gate, science guard, fallback),
// streamed one sentence per chunk. Nothing of the conversation is logged or kept here; each turn
// logs one status line (model used or fallback, timings, the provider's error) for the function's logs.
export const RTC_LLM_PATH = "/rtc/v1/chat/completions";
const BODY_LIMIT = 256_000;

export function rtcLlmEnabled() {
  return Boolean(process.env.RTC_LLM_KEY);
}

export async function handleRtcChatCompletions(request, response) {
  if (!authorized(request)) return sendJson(response, 401, { error: { message: "unauthorized" } });
  let body;
  try {
    body = JSON.parse(await readBody(request));
  } catch {
    return sendJson(response, 400, { error: { message: "invalid-json" } });
  }
  const { input, state } = rtcTurn(body);
  if (!input) return sendJson(response, 400, { error: { message: "no-user-message" } });

  const abort = new AbortController();
  response.once("close", () => abort.abort());
  const id = `chatcmpl-${Date.now().toString(36)}`, created = Math.floor(Date.now() / 1000), model = String(body.model || "xiaoyu");
  const replies = streamQuickTutorReplyWithQwen(input, createTutorContext(state), "", { signal: abort.signal });
  let status = null;
  try {
    if (body.stream === false) {
      const sentences = [];
      for await (const item of replies) {
        if (item.type === "done") status = item.llmStatus;
        if (item.type === "sentence") sentences.push(item.text);
      }
      return sendJson(response, 200, { id, object: "chat.completion", created, model,
        choices: [{ index: 0, message: { role: "assistant", content: sentences.join("") }, finish_reason: "stop" }] });
    }
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    const chunk = (delta, finish = null) => response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    let first = true;
    for await (const item of replies) {
      if (response.destroyed) break;
      if (item.type === "done") status = item.llmStatus;
      if (item.type !== "sentence") continue;
      chunk(first ? { role: "assistant", content: item.text } : { content: item.text });
      first = false;
    }
    if (!response.destroyed) {
      chunk({}, "stop");
      response.end("data: [DONE]\n\n");
    }
  } catch {
    if (response.headersSent) response.destroy(); else sendJson(response, 502, { error: { message: "reply-failed" } });
  } finally {
    abort.abort();
    console.log(JSON.stringify({ rtcReply: replyStatus(status) }));
  }
}

export function replyStatus(status) {
  if (!status) return { ended: "before-reply" };
  const { provider, model, used, fallback, latencyMs, firstSentenceMs, message, stoppedBy } = status;
  return { provider, model, used, fallback, latencyMs, firstSentenceMs, message, stoppedBy };
}

// The child's latest words and the earlier turns, in the page's message shape. The userData given
// when the call started ({"ageBand":"4-5","context":{profile, activeSpeaker, memory, messages}}, see
// rtcCall.mjs) adds the child's profile and memory, and the sentences said before the call came
// first. Without it (the console's demo token) only RTC_DEFAULT_AGE_BAND is known.
export function rtcTurn(body = {}) {
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .map(message => ({ role: message?.role, text: contentText(message?.content) }))
    .filter(message => ["user", "assistant"].includes(message.role) && message.text);
  const lastUser = messages.map(message => message.role).lastIndexOf("user");
  if (lastUser < 0) return { input: "", state: {} };
  const history = messages.slice(0, lastUser).map(message => ({ role: message.role === "user" ? "child" : "tutor", text: message.text }));
  const data = userData(body.extendData);
  const context = data.context && typeof data.context === "object" ? data.context : {};
  const ageBand = data.ageBand || process.env.RTC_DEFAULT_AGE_BAND || "4-5";
  const before = Array.isArray(context.messages) ? context.messages : [];
  return { input: messages[lastUser].text.slice(0, 4000), state: {
    profile: { ...(context.profile || {}), ageBand: String(ageBand).slice(0, 10) },
    ...(context.activeSpeaker ? { activeSpeaker: context.activeSpeaker } : {}),
    ...(context.memory ? { memory: context.memory } : {}),
    messages: [...before, ...history]
  } };
}

function contentText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map(part => (part?.type === "text" && typeof part.text === "string" ? part.text : "")).join("").trim();
  return "";
}

function userData(extendData) {
  const raw = extendData?.userData;
  if (raw && typeof raw === "object") return raw;
  try { return typeof raw === "string" ? JSON.parse(raw) || {} : {}; } catch { return {}; }
}

function authorized(request) {
  const expected = Buffer.from(String(process.env.RTC_LLM_KEY || ""));
  const header = String(request.headers.authorization || "");
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
}

async function readBody(request) {
  let size = 0;
  const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > BODY_LIMIT) throw new Error("too-large");
    parts.push(part);
  }
  return Buffer.concat(parts).toString("utf8");
}

function sendJson(response, status, data) {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}
