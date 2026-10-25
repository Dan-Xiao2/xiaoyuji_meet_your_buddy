import WebSocket, { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { deriveDashScopeServiceUrl } from "./qwenSpeech.mjs";

export function realtimeAsrConfig(env = process.env) {
  const key = String(env.QWEN_API_KEY || "").trim();
  const endpoint = new URL(deriveDashScopeServiceUrl(env.QWEN_BASE_URL, "/api-ws/v1/realtime"));
  endpoint.protocol = "wss:";
  const model = env.QWEN_ASR_REALTIME_MODEL || "qwen3-asr-flash-realtime";
  endpoint.searchParams.set("model", model);
  return {
    enabled: env.ASR_REALTIME !== "false" && (env.ASR_PROVIDER || "qwen") === "qwen" && Boolean(key && !key.startsWith("replace_me") && !key.includes("your_")),
    endpoint: endpoint.href, key, model,
    language: /^en/i.test(env.VOICE_LANGUAGE || "") ? "en" : /^yue/i.test(env.VOICE_LANGUAGE || "") ? "yue" : "zh"
  };
}

// One browser connection is one utterance; only the server holds the provider key.
export function attachRealtimeAsr(server, { config = realtimeAsrConfig, connect = (url, options) => new WebSocket(url, options) } = {}) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  server.on("upgrade", (request, socket, head) => {
    let sameOrigin = false;
    try { sameOrigin = new URL(request.headers.origin).host === request.headers.host; } catch { /* Missing/invalid origins are refused. */ }
    if (request.url !== "/api/asr/realtime" || !sameOrigin || sockets.clients.size >= 4) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit("connection", client));
  });
  sockets.on("connection", client => {
    const settings = config();
    let upstream, done = false, ready = false, committed = false, bytes = 0, timer;
    const send = data => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data)); };
    const close = () => {
      clearTimeout(timer);
      if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
      if (client.readyState === WebSocket.OPEN) client.close();
    };
    const fail = code => {
      if (done) return;
      done = true;
      send({ type: "error", code });
      close();
    };
    const deadline = ms => { clearTimeout(timer); timer = setTimeout(() => fail("timeout"), ms); };
    const emit = (type, data = {}) => upstream.send(JSON.stringify({ event_id: randomUUID(), type, ...data }));
    client.on("error", () => fail("client-error"));
    client.on("close", () => { done = true; close(); });
    if (!settings.enabled) { fail("disabled"); return; }
    try {
      upstream = connect(settings.endpoint, { headers: { Authorization: `Bearer ${settings.key}`, "OpenAI-Beta": "realtime=v1" }, handshakeTimeout: 5000, maxPayload: 65536 });
    } catch { fail("connect-failed"); return; }
    deadline(5000);
    upstream.on("open", () => {
      if (done) return;
      emit("session.update", { session: { modalities: ["text"], input_audio_format: "pcm", sample_rate: 16000, input_audio_transcription: { language: settings.language }, turn_detection: null } });
    });
    upstream.on("error", () => fail("upstream-error"));
    upstream.on("close", () => { if (!done) fail("disconnected"); });
    upstream.on("message", raw => {
      if (done) return;
      let event;
      try { event = JSON.parse(String(raw)); } catch { fail("invalid-response"); return; }
      if (event.type === "session.updated" && !ready) {
        ready = true;
        deadline(25000);
        send({ type: "ready", model: settings.model });
      } else if (event.type === "conversation.item.input_audio_transcription.completed") {
        if (!committed) { fail("unexpected-final"); return; }
        const text = String(event.transcript || "").trim();
        if (!text) { fail("empty-transcript"); return; }
        done = true;
        send({ type: "final", text, audioSeconds: bytes / 32000 });
        close();
      } else if (event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed") {
        fail("recognition-failed");
      } else if (event.type === "session.finished") {
        fail("empty-transcript");
      }
      // Partial text and provider emotion estimates never enter Tutor or growth records.
    });
    client.on("message", (raw, binary) => {
      if (done) return;
      if (!ready || committed) { fail("invalid-state"); return; }
      if (binary) {
        bytes += raw.length;
        if (!raw.length || raw.length % 2 || bytes > 640000 || upstream.bufferedAmount > 128000) { fail("audio-limit"); return; }
        emit("input_audio_buffer.append", { audio: raw.toString("base64") });
      } else {
        let event;
        try { event = JSON.parse(String(raw)); } catch { fail("invalid-request"); return; }
        if (event.type !== "finish" || !bytes) { fail("invalid-request"); return; }
        committed = true;
        deadline(5000);
        emit("input_audio_buffer.commit");
        emit("session.finish");
      }
    });
  });
  return sockets;
}
