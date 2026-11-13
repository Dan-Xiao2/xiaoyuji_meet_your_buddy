import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { rtcCallEnabled, signedRequest, startRtcCall } from "../server/rtcCall.mjs";

const env = { ALIYUN_ACCESS_KEY_ID: "test-id", ALIYUN_ACCESS_KEY_SECRET: "test-secret", RTC_AGENT_ID: "agent-1" };

test("a call needs the AccessKey and the agent id", () => {
  assert.equal(rtcCallEnabled(env), true);
  assert.equal(rtcCallEnabled({ ...env, RTC_AGENT_ID: "" }), false);
  return assert.rejects(startRtcCall({}, { env: {} }), { message: "rtc-not-configured", status: 503 });
});

test("the request is signed with V3; without a context only the age band goes", async () => {
  let seen;
  const fetch = async (url, init) => { seen = { url: new URL(url), init }; return Response.json({
    InstanceId: "i1", ChannelId: "c1", UserId: "u1", Token: "t1", RequestId: "r1" }); };
  const agent = await startRtcCall({ ageBand: "5-6" }, { env, fetch });
  assert.deepEqual(agent, { instanceId: "i1", channelId: "c1", userId: "u1", rtcToken: "t1", reqId: "r1" });
  assert.equal(seen.url.host, "ice.cn-shanghai.aliyuncs.com");
  assert.equal(seen.init.headers["x-acs-action"], "GenerateAIAgentCall");
  assert.match(seen.init.headers.Authorization, /^ACS3-HMAC-SHA256 Credential=test-id,SignedHeaders=content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=[0-9a-f]{64}$/);
  assert.equal(seen.url.search, "");
  const form = new URLSearchParams(seen.init.body);
  assert.equal(form.get("AIAgentId"), "agent-1");
  assert.deepEqual(JSON.parse(form.get("UserData")), { ageBand: "5-6" });
  assert.match(form.get("UserId"), /^child-[0-9a-f-]{12}$/);
  assert.ok(!seen.init.body.includes("test-secret"));
});

test("an unknown age band falls back to 4-5, and a provider error keeps only its code", async () => {
  let userData;
  const ok = async (url, init) => { userData = new URLSearchParams(init.body).get("UserData"); return Response.json({ Token: "t" }); };
  await startRtcCall({ ageBand: "<script>" }, { env, fetch: ok });
  assert.equal(userData, "{\"ageBand\":\"4-5\"}");
  const denied = async () => Response.json({ Code: "Forbidden.RAM", Message: "secret details" }, { status: 403 });
  await assert.rejects(startRtcCall({}, { env, fetch: denied }), { message: "rtc-start-failed:Forbidden.RAM", status: 502 });
});

test("the form body encodes like RFC 3986 and the signature is stable", () => {
  const args = { host: "ice.cn-shanghai.aliyuncs.com", action: "GenerateAIAgentCall", params: { B: "a b*", A: "{\"x\":1}" },
    accessKeyId: "id", accessKeySecret: "secret", date: new Date("2026-11-11T08:00:00.123Z"), nonce: "n" };
  const first = signedRequest(args);
  assert.equal(first.url, "https://ice.cn-shanghai.aliyuncs.com/");
  assert.equal(first.body, "A=%7B%22x%22%3A1%7D&B=a%20b%2A");
  assert.equal(first.headers["x-acs-content-sha256"], createHash("sha256").update(first.body).digest("hex"));
  assert.equal(first.headers["x-acs-date"], "2026-11-11T08:00:00Z");
  assert.equal(signedRequest(args).headers.Authorization, first.headers.Authorization);
  assert.notEqual(signedRequest({ ...args, accessKeySecret: "other" }).headers.Authorization, first.headers.Authorization);
});

test("the call carries the bounded reply summary, not the archive", async () => {
  const { callUserData } = await import("../server/rtcCall.mjs");
  const long = "很".repeat(500);
  const data = callUserData("5-6", {
    profile: { name: "小明", ageBand: "6-7", interest: "恐龙", goal: "多说完整的话", birthday: "2021-01-01" },
    activeSpeaker: { name: "小明", role: "child" },
    memory: { interests: ["a", "b", "c", "d", "e", "f", "g", "h"], recentWins: ["数到十"], growthMoments: ["不应带出"] },
    messages: Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "tutor" : "child", text: `${index}${long}`, id: `m${index}` })),
    studentModel: { secret: true }, familyEntries: [{ photo: "data:" }]
  });
  assert.deepEqual(Object.keys(data.context).sort(), ["activeSpeaker", "memory", "messages", "profile"]);
  assert.deepEqual(data.context.profile, { name: "小明", ageBand: "5-6", interest: "恐龙", goal: "多说完整的话" });
  assert.deepEqual(data.context.memory, { interests: ["c", "d", "e", "f", "g", "h"], recentWins: ["数到十"] });
  assert.equal(data.context.messages.length, 6);
  assert.ok(data.context.messages.every(message => message.text.length === 200 && !("id" in message)));
  assert.ok(JSON.stringify(data).length < 4000);
  assert.deepEqual(callUserData("x"), { ageBand: "4-5" });
});
