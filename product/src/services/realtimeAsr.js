// corpus: recent conversation text, sent before any audio so the recogniser prefers words already
// used in this conversation over same-sounding ones.
// context: the page's shared AudioContext (see voiceService.js), left open on release; without one
// a private context is created and closed. Native rate: the worklet converts to 16 kHz itself.
// onHeard: called once when the recogniser has heard the first character (no text is given).
export async function createRealtimeCapture(stream, { onTiming, onHeard, corpus = "", context: shared = null } = {}) {
  const context = shared || new AudioContext();
  let node, source, socket, timer, flushTimer, flushResolve;
  let active = false, ready = false, stopped = false, finishing = false, settled = false;
  let queue = [], queuedBytes = 0, connectedAt = 0;
  let resolveResult;
  const result = new Promise(resolve => { resolveResult = resolve; });
  const releaseCapture = () => {
    source?.disconnect(); node?.disconnect();
    if (node) node.port.onmessage = null;
    if (!shared && context.state !== "closed") context.close().catch(() => {});
  };
  const settle = value => {
    if (settled) return;
    settled = true;
    clearTimeout(timer); clearTimeout(flushTimer);
    flushResolve?.();
    queue = []; queuedBytes = 0;
    releaseCapture();
    socket?.close();
    resolveResult(value);
  };
  const fail = code => settle({ ok: false, code });
  const sendFinish = () => {
    if (settled || !ready || !finishing) return;
    socket.send(JSON.stringify({ type: "finish" }));
  };
  const append = buffer => {
    if (settled) return;
    if (active && ready) {
      if (socket.bufferedAmount > 128000) { fail("backpressure"); return; }
      socket.send(buffer);
    } else {
      queue.push(buffer); queuedBytes += buffer.byteLength;
      if (!active) {
        while (queuedBytes > 25600) queuedBytes -= queue.shift().byteLength;
      } else if (queuedBytes > 192000) fail("connect-buffer-limit");
    }
  };
  try {
    if (context.sampleRate < 16000) throw new Error("Unsupported input sample rate");
    await Promise.race([
      (async () => {
        await context.resume();
        await context.audioWorklet.addModule(new URL("./asrCaptureWorklet.js", import.meta.url));
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Audio setup timed out")), 3000); })
    ]);
    clearTimeout(timer);
    // No output: the capture graph is never connected to the speaker. On an iPhone, a running
    // output while the microphone records was a suspect for noise heard while the child spoke.
    node = new AudioWorkletNode(context, "asr-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
    source = context.createMediaStreamSource(stream);
    source.connect(node);
    node.port.onmessage = ({ data }) => {
      if (data?.type === "flushed") { clearTimeout(flushTimer); flushResolve?.(); }
      else if (data instanceof ArrayBuffer) append(data);
    };
  } catch (error) { releaseCapture(); clearTimeout(timer); throw error; }
  return {
    start() {
      if (active || settled) return;
      active = true;
      connectedAt = performance.now();
      const url = new URL("/api/asr/realtime", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      try { socket = new WebSocket(url); } catch { fail("connect-failed"); return; }
      timer = setTimeout(() => fail("connect-timeout"), 5500);
      socket.onerror = () => fail("connection-failed");
      socket.onopen = () => { if (!settled && corpus) socket.send(JSON.stringify({ type: "context", text: corpus.slice(0, 2000) })); };
      socket.onclose = () => { if (!settled) fail("disconnected"); };
      socket.onmessage = ({ data }) => {
        if (settled) return;
        let event;
        try { event = JSON.parse(data); } catch { fail("invalid-response"); return; }
        if (event.type === "ready" && !ready) {
          ready = true;
          clearTimeout(timer);
          timer = setTimeout(() => fail("session-timeout"), finishing ? 5500 : 25000);
          onTiming?.({ stage: "asr-realtime-connect", latencyMs: performance.now() - connectedAt });
          const pending = queue; queue = []; queuedBytes = 0;
          for (const buffer of pending) append(buffer);
          sendFinish();
        } else if (event.type === "final" && finishing && typeof event.text === "string" && event.text.trim()) {
          settle({ ok: true, text: event.text.trim(), audioSeconds: event.audioSeconds });
        } else if (event.type === "heard") {
          try { onHeard?.(); } catch { /* the page's reaction must not break recognition */ }
        } else if (event.type === "error") fail(event.code || "recognition-failed");
      };
    },
    async finish() {
      if (settled) return result;
      if (!active) { fail("no-speech"); return result; }
      if (!stopped) {
        stopped = true;
        await new Promise(resolve => {
          flushResolve = resolve;
          flushTimer = setTimeout(() => { fail("capture-flush-timeout"); resolve(); }, 1000);
          node.port.postMessage({ type: "flush" });
        });
        releaseCapture();
        if (!settled) {
          finishing = true;
          clearTimeout(timer);
          timer = setTimeout(() => fail("final-timeout"), 5500);
          sendFinish();
        }
      }
      return result;
    },
    cancel() { fail("cancelled"); }
  };
}
