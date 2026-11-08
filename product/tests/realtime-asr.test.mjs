import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventEmitter, once } from "node:events";
import WebSocket from "ws";
import { attachRealtimeAsr, realtimeAsrConfig } from "../server/realtimeAsr.mjs";

async function fixture(t, options = {}) {
  const upstreams = [];
  const server = createServer();
  const sockets = attachRealtimeAsr(server, {
    ...options,
    config: () => ({ enabled: true, endpoint: "wss://example.invalid", key: "server-only", model: "test-model", language: "zh" }),
    connect(_url, options) {
      assert.equal(options.headers.Authorization, "Bearer server-only");
      const upstream = new EventEmitter();
      Object.assign(upstream, { readyState: 1, bufferedAmount: 0, events: [],
        send(raw) { this.events.push(JSON.parse(raw)); },
        terminate() { this.readyState = 3; this.emit("close"); }
      });
      upstreams.push(upstream);
      queueMicrotask(() => upstream.emit("open"));
      return upstream;
    }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const client of sockets.clients) client.terminate();
    sockets.close();
    await new Promise(resolve => server.close(resolve));
  });
  async function client() {
    const ws = new WebSocket(origin.replace("http", "ws") + "/api/asr/realtime", { origin });
    await once(ws, "open");
    const upstream = upstreams.at(-1);
    const ready = once(ws, "message");
    upstream.emit("message", JSON.stringify({ type: "session.updated" }));
    assert.equal(JSON.parse((await ready)[0]).type, "ready");
    return { ws, upstream };
  }
  return { origin, client, upstreams };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

test("regional endpoint follows existing base URL and realtime can be disabled", () => {
  const config = realtimeAsrConfig({ QWEN_API_KEY: "example-key", QWEN_BASE_URL: "https://test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" });
  assert.equal(config.enabled, true);
  assert.equal(config.endpoint, "wss://test.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime");
  assert.equal(realtimeAsrConfig({ QWEN_API_KEY: "example-key", ASR_REALTIME: "false" }).enabled, false);
  assert.equal(realtimeAsrConfig({ QWEN_API_KEY: "replace_me" }).enabled, false);
});

test("streams PCM before finish and returns a single final, never partial guesses", async t => {
  const { client } = await fixture(t);
  const { ws, upstream } = await client();
  assert.equal(upstream.events[0].session.turn_detection, null);
  const messages = []; ws.on("message", raw => messages.push(JSON.parse(raw)));
  ws.send(Buffer.from([0, 0, 1, 0])); await tick();
  assert.equal(upstream.events[1].type, "input_audio_buffer.append");
  upstream.emit("message", JSON.stringify({ type: "conversation.item.input_audio_transcription.text", text: "猜测", stash: "草稿" }));
  await tick(); assert.deepEqual(messages, [{ type: "heard" }], "only that someone spoke, never the guess");
  ws.send(JSON.stringify({ type: "finish" })); await tick();
  assert.deepEqual(upstream.events.slice(-2).map(x => x.type), ["input_audio_buffer.commit", "session.finish"]);
  const closed = once(ws, "close");
  const final = JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "画一个房子" });
  upstream.emit("message", final); upstream.emit("message", final);
  await closed;
  assert.equal(messages.length, 2); assert.equal(messages[1].text, "画一个房子");
  assert.equal(JSON.stringify(messages).includes("猜测"), false);
  assert.equal(upstream.readyState, 3);
});

test("speech start is reported once on open, never on finish, and a failing hook never breaks recognition", async t => {
  let calls = 0;
  const { client } = await fixture(t, { onSpeechStart: () => { calls++; throw new Error("warm-up failed"); } });
  const { ws, upstream } = await client();
  assert.equal(calls, 1);
  ws.send(Buffer.from([0, 0, 1, 0])); await tick();
  ws.send(JSON.stringify({ type: "finish" })); await tick();
  assert.equal(calls, 1, "warming at finish would occupy the sockets the reply request needs next");
  const message = once(ws, "message");
  upstream.emit("message", JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "天空为什么是蓝色的" }));
  assert.equal(JSON.parse((await message)[0]).text, "天空为什么是蓝色的");
});

test("an unauthorized client cannot open a paid recognition connection", async t => {
  const { origin, upstreams } = await fixture(t, { authorize: () => false });
  const ws = new WebSocket(origin.replace("http", "ws") + "/api/asr/realtime", { origin });
  const [, response] = await once(ws, "unexpected-response");
  assert.equal(response.statusCode, 403);
  assert.equal(upstreams.length, 0);
});

test("conversation context sent before audio becomes recogniser corpus; a second or late context is refused", async t => {
  const { origin, upstreams } = await fixture(t);
  const ws = new WebSocket(origin.replace("http", "ws") + "/api/asr/realtime", { origin });
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "context", text: "小宇\n牛肝菌是一种蘑菇" }));
  await tick();
  const upstream = upstreams.at(-1);
  const updates = upstream.events.filter(event => event.type === "session.update");
  assert.equal(updates.at(-1).session.input_audio_transcription.corpus.text, "小宇\n牛肝菌是一种蘑菇");
  const messages = []; ws.on("message", raw => messages.push(JSON.parse(raw)));
  ws.send(JSON.stringify({ type: "context", text: "第二次" }));
  await once(ws, "close");
  assert.deepEqual(messages, [{ type: "error", code: "invalid-request" }]);
  assert.equal(upstream.events.filter(event => event.type === "session.update").length, updates.length, "no update from a refused context");
});

test("cancel disconnects upstream; a new utterance has no old audio or late result", async t => {
  const { client } = await fixture(t);
  const first = await client();
  const closed = once(first.ws, "close"); first.ws.close(); await closed; await tick();
  assert.equal(first.upstream.readyState, 3);
  const next = await client(); const messages = [];
  next.ws.on("message", raw => messages.push(JSON.parse(raw)));
  first.upstream.emit("message", JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "旧内容" }));
  await tick(); assert.deepEqual(messages, []);
  assert.equal(next.upstream.events.length, 1);
  next.ws.close();
});

test("disconnect, malformed PCM and duplicate commits fail without leaking provider details", async t => {
  const { client } = await fixture(t);
  for (const kind of ["disconnect", "odd-pcm", "duplicate"]) {
    const { ws, upstream } = await client(); const response = once(ws, "message");
    if (kind === "disconnect") upstream.emit("error", new Error("private provider details"));
    if (kind === "odd-pcm") ws.send(Buffer.from([1]));
    if (kind === "duplicate") { ws.send(Buffer.alloc(3200)); ws.send('{"type":"finish"}'); ws.send('{"type":"finish"}'); }
    const data = JSON.parse((await response)[0]);
    assert.equal(data.type, "error"); assert.equal(data.message, undefined);
    await tick(); assert.equal(upstream.readyState, 3);
  }
});

test("foreign origins cannot open a paid upstream connection", async t => {
  const { origin, upstreams } = await fixture(t);
  const ws = new WebSocket(origin.replace("http", "ws") + "/api/asr/realtime", { origin: "https://other.invalid" });
  const [error] = await once(ws, "error");
  assert.match(error.message, /403/); assert.equal(upstreams.length, 0);
});

test("the first recognised character is signalled once, without its text, and not after finish", async t => {
  const { client } = await fixture(t);
  const { ws, upstream } = await client();
  const messages = []; ws.on("message", raw => messages.push(JSON.parse(raw)));
  ws.send(Buffer.from([0, 0, 1, 0])); await tick();
  upstream.emit("message", JSON.stringify({ type: "conversation.item.input_audio_transcription.text", text: "", stash: "" }));
  await tick(); assert.equal(messages.length, 0, "an empty partial (no speech) is not a person speaking");
  upstream.emit("message", JSON.stringify({ type: "conversation.item.input_audio_transcription.text", text: "", stash: "草莓" }));
  upstream.emit("message", JSON.stringify({ type: "conversation.item.input_audio_transcription.text", text: "草莓", stash: "多少" }));
  await tick();
  assert.deepEqual(messages, [{ type: "heard" }]);
  assert.equal(JSON.stringify(messages).includes("草莓"), false, "no partial text leaves the server");
});

test("while Xiaoyu speaks, her own echo and a short backchannel are not signalled as the child; real words are", async t => {
  const { client } = await fixture(t);
  const { ws, upstream } = await client();
  const messages = []; ws.on("message", raw => messages.push(JSON.parse(raw)));
  ws.send(JSON.stringify({ type: "speaking", text: "蜗牛背着自己的房子慢慢爬。" }));
  ws.send(Buffer.from([0, 0, 1, 0])); await tick();
  const partial = text => upstream.emit("message", JSON.stringify({ type: "conversation.item.input_audio_transcription.text", text }));
  partial("蜗牛背着自己"); await tick();
  partial("嗯嗯"); await tick();
  assert.deepEqual(messages, [], "echo and backchannel do not count");
  partial("我想看蚂蚁"); await tick();
  assert.deepEqual(messages, [{ type: "heard" }]);
  ws.send(JSON.stringify({ type: "finish" })); await tick();
  const closed = once(ws, "close");
  upstream.emit("message", JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "我想看蚂蚁" }));
  await closed;
  assert.deepEqual(messages.at(-1).suppressed, { echo: 1, backchannel: 1 });
  assert.equal(JSON.stringify(messages.slice(0, -1)).includes("蚂蚁"), false, "partial text never reaches the page");
});

test("the recogniser tells the page when the child sounds finished or mid-thought, without the words", async t => {
  const { client } = await fixture(t);
  const { ws, upstream } = await client();
  const messages = []; ws.on("message", raw => messages.push(JSON.parse(raw)));
  ws.send(Buffer.from([0, 0, 1, 0])); await tick();
  const partial = text => upstream.emit("message", JSON.stringify({ type: "conversation.item.input_audio_transcription.text", text }));
  partial("我看到一只蜗牛然后"); await tick();
  partial("我看到一只蜗牛然后它跑了吗"); await tick();
  partial("我看到一只蜗牛然后它跑了吗"); await tick();
  assert.deepEqual(messages, [{ type: "heard" }, { type: "endpoint", hint: "unfinished" }, { type: "endpoint", hint: "complete" }], "each change once");
  assert.equal(JSON.stringify(messages).includes("蜗牛"), false);
});
