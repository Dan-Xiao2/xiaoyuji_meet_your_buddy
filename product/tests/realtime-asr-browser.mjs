import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.goto(process.env.TEST_URL || "http://localhost:4173/");
    for (const mode of ["success", "disconnect", "cancel", "silent", "cancel-pending", "delayed-ready"]) {
      const result = await page.evaluate(async mode => {
        const { createVoiceController } = await import("/src/services/voiceService.js");
        const audio = new AudioContext(); await audio.resume();
        const output = audio.createMediaStreamDestination();
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        gain.gain.value = 0; oscillator.connect(gain).connect(output); oscillator.start();
        const previous = { ws: window.WebSocket, fetch: window.fetch, gum: navigator.mediaDevices.getUserMedia };
        const state = { sockets: 0, chunks: 0, batch: 0, ends: [], timings: [], beforeFinish: false, closed: 0, errors: [] };
        let finishSent = false;
        window.WebSocket = class {
          constructor() {
            this.bufferedAmount = 0; this.closed = false; state.sockets++;
            setTimeout(() => { if (!this.closed) this.onmessage?.({ data: '{"type":"ready"}' }); }, mode === "delayed-ready" ? 2500 : 40);
          }
          send(value) {
            if (typeof value !== "string") {
              state.chunks++; state.beforeFinish ||= !finishSent;
              if (mode === "disconnect" && state.chunks === 2) this.onerror?.();
            } else {
              finishSent = true;
              if (mode === "cancel-pending") return;
              const event = { data: JSON.stringify({ type: "final", text: "画一个房子", audioSeconds: state.chunks / 10 }) };
              this.onmessage?.(event); this.onmessage?.(event);
            }
          }
          close() { if (!this.closed) { this.closed = true; state.closed++; this.onclose?.(); } }
        };
        navigator.mediaDevices.getUserMedia = async () => output.stream;
        window.fetch = async (url, options) => {
          if (url !== "/api/transcribe") return previous.fetch(url, options);
          state.batch++;
          const payload = JSON.parse(options.body);
          const bytes = Uint8Array.from(atob(payload.audioBase64), c => c.charCodeAt(0));
          const decoded = await audio.decodeAudioData(bytes.buffer);
          state.backupDuration = decoded.duration;
          return new Response(JSON.stringify({ text: "画一个房子", latencyMs: 1 }));
        };
        const voice = createVoiceController();
        try {
          await new Promise((resolve, reject) => {
            const limit = setTimeout(() => reject(new Error("capture timed out")), 10000);
            const finish = () => { clearTimeout(limit); resolve(); };
            voice.listen({ preferRecorder: true, preferRealtime: true,
              onStart() {
                if (mode !== "silent") {
                  gain.gain.setValueAtTime(0.2, audio.currentTime + 0.15);
                  gain.gain.setValueAtTime(0, audio.currentTime + 1.05);
                }
                if (mode === "cancel") setTimeout(() => { voice.stopListening(); setTimeout(finish, 250); }, 550);
                if (mode === "silent") setTimeout(() => voice.finishListening(), 400);
              },
              onTiming(event) { state.timings.push(event.stage); },
              onProcessing() {
                if (mode === "cancel-pending") setTimeout(() => { voice.stopListening(); setTimeout(finish, 250); }, 150);
              },
              onEnd(text) { state.ends.push(text); setTimeout(finish, 100); },
              onError(error) { state.errors.push(error); clearTimeout(limit); reject(new Error(error)); }
            });
          });
          state.trackStopped = output.stream.getTracks().every(track => track.readyState === "ended");
          return state;
        } finally {
          voice.stopListening(); oscillator.stop(); await audio.close();
          window.WebSocket = previous.ws; window.fetch = previous.fetch; navigator.mediaDevices.getUserMedia = previous.gum;
        }
      }, mode);
      assert.deepEqual(result.errors, []);
      assert.equal(result.trackStopped, true);
      if (mode === "silent") { assert.equal(result.sockets, 0); assert.equal(result.batch, 0); assert.deepEqual(result.ends, [""]); }
      else {
        assert.equal(result.sockets, 1); assert.equal(result.closed, 1); assert.ok(result.beforeFinish);
        if (mode.startsWith("cancel")) { assert.deepEqual(result.ends, []); assert.equal(result.batch, 0); }
        else {
          assert.deepEqual(result.ends, ["画一个房子"]);
          assert.equal(result.batch, mode === "disconnect" ? 1 : 0);
          if (mode === "disconnect") { assert.ok(result.backupDuration > 1.5); assert.ok(result.timings.includes("asr-realtime-fallback")); }
        }
      }
      console.log(`PASS ${width}px ${mode}:`, JSON.stringify(result));
    }
    await page.close();
  }
} finally { await browser.close(); }
