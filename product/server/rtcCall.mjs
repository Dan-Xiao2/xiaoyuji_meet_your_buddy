import { createHash, createHmac, randomUUID } from "node:crypto";
import { createTutorContext } from "../src/services/tutorContext.js";

// Starts a call with Alibaba Cloud's AI real-time interaction agent for the child's screen
// (GenerateAIAgentCall, ICE 2020-11-09). The phone then joins the call with what this returns; the
// agent's LLM node calls Xiaoyu's reply endpoint (rtcLlm.mjs on Function Compute), passing the call's
// userData with every turn. userData holds the same bounded summary the page sends for a web reply
// (user decision 2026-11-11): profile, the latest interests and wins, and the last few sentences
// before the call. It does not grow with the archive; growth records and photos stay on the device.
// Needs a RAM user's AccessKey with ice:GenerateAIAgentCall only, and the agent's ID.
const VERSION = "2020-11-09";
const AGE_BANDS = new Set(["3-4", "4-5", "5-6", "6-7"]);
// How long the phone may take to join; the SDK renews the token itself during a call.
const EXPIRE_SECONDS = 3600;
// Earlier sentences carried into the call: enough to continue the topic, short enough for userData.
const CALL_MESSAGES = 6, CALL_MESSAGE_CHARS = 200;

export function rtcCallEnabled(env = process.env) {
  return Boolean(env.ALIYUN_ACCESS_KEY_ID && env.ALIYUN_ACCESS_KEY_SECRET && env.RTC_AGENT_ID);
}

export async function startRtcCall({ ageBand, context } = {}, { env = process.env, fetch: request = fetch, signal } = {}) {
  if (!rtcCallEnabled(env)) throw Object.assign(new Error("rtc-not-configured"), { status: 503 });
  const region = env.RTC_REGION || "cn-shanghai";
  const params = {
    AIAgentId: env.RTC_AGENT_ID,
    // A random id per call: the RTC user is not tied to a child or a family.
    UserId: `child-${randomUUID().slice(0, 12)}`,
    Expire: String(EXPIRE_SECONDS),
    UserData: JSON.stringify(callUserData(ageBand, context))
  };
  const signed = signedRequest({ host: `ice.${region}.aliyuncs.com`, action: "GenerateAIAgentCall", params,
    accessKeyId: env.ALIYUN_ACCESS_KEY_ID, accessKeySecret: env.ALIYUN_ACCESS_KEY_SECRET });
  const response = await request(signed.url, { method: "POST", headers: signed.headers, body: signed.body, signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.Token) {
    // The provider's code only (e.g. Forbidden.RAM), never the key or the response body.
    throw Object.assign(new Error(`rtc-start-failed:${data.Code || response.status}`), { status: 502 });
  }
  return { instanceId: data.InstanceId, channelId: data.ChannelId, userId: data.UserId, rtcToken: data.Token, reqId: data.RequestId };
}

export function callUserData(ageBand, context) {
  const band = AGE_BANDS.has(ageBand) ? ageBand : "4-5";
  if (!context || typeof context !== "object") return { ageBand: band };
  const { profile, activeSpeaker, memory, messages } = createTutorContext(context);
  return { ageBand: band, context: {
    profile: { ...profile, ageBand: band }, activeSpeaker, memory,
    messages: messages.slice(-CALL_MESSAGES).map(({ role, text, speakerName, speakerRole }) =>
      ({ role, text: text.slice(0, CALL_MESSAGE_CHARS), speakerName, speakerRole }))
  } };
}

// Alibaba Cloud signature V3 (ACS3-HMAC-SHA256). Parameters go in a form body, not the query string:
// userData with Chinese text grows about ninefold when URL-encoded and could pass the gateway's URL limit.
export function signedRequest({ host, action, params, accessKeyId, accessKeySecret, date = new Date(), nonce = randomUUID() }) {
  const body = Object.keys(params).sort().map(key => `${encode(key)}=${encode(params[key])}`).join("&");
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    host,
    "x-acs-action": action,
    "x-acs-content-sha256": sha256(body),
    "x-acs-date": date.toISOString().replace(/\.\d{3}Z$/, "Z"),
    "x-acs-signature-nonce": nonce,
    "x-acs-version": VERSION
  };
  const names = Object.keys(headers).sort();
  const canonical = ["POST", "/", "", names.map(name => `${name}:${headers[name]}\n`).join(""), names.join(";"), headers["x-acs-content-sha256"]].join("\n");
  const signature = createHmac("sha256", accessKeySecret).update(`ACS3-HMAC-SHA256\n${sha256(canonical)}`).digest("hex");
  headers.Authorization = `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${names.join(";")},Signature=${signature}`;
  return { url: `https://${host}/`, headers, body };
}

const sha256 = text => createHash("sha256").update(text).digest("hex");
const encode = value => encodeURIComponent(String(value)).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
