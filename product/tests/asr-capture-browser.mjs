// The realtime capture worklet runs at the device's native rate and must still deliver 16 kHz mono
// PCM16 to the recogniser: right length, same pitch, healthy level. A synthetic 440 Hz tone stands
// in for the microphone; a fake socket collects what would be sent. No microphone or service is used.
import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const page = await browser.newPage();
  await page.goto((process.env.TEST_URL || "http://127.0.0.1:4197/") + "index.html");
  const run = shareContext => page.evaluate(async shareContext => {
    const sent = [];
    window.WebSocket = class {
      constructor() { setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); }, 10); }
      send(data) { if (data instanceof ArrayBuffer) sent.push(data); else if (JSON.parse(data).type === "finish") setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "final", text: "测试" }) }), 10); }
      close() {}
      get bufferedAmount() { return 0; }
    };
    const source = new AudioContext({ sampleRate: 48000 }); await source.resume();
    const tone = source.createOscillator(), gain = source.createGain(), out = source.createMediaStreamDestination();
    tone.frequency.value = 440; gain.gain.value = 0.5; tone.connect(gain).connect(out);
    const { createRealtimeCapture } = await import("/src/services/realtimeAsr.js");
    // The page shares one AudioContext between playback and capture; capture must not close it.
    const shared = shareContext ? new AudioContext() : null;
    if (shared) await shared.resume();
    const capture = await createRealtimeCapture(out.stream, shared ? { context: shared } : {});
    tone.start(); capture.start();
    await new Promise(resolve => setTimeout(resolve, 1000));
    tone.stop();
    const outcome = await capture.finish();
    const samples = [];
    for (const buffer of sent) { const view = new DataView(buffer); for (let i = 0; i < buffer.byteLength; i += 2) samples.push(view.getInt16(i, true) / 32768); }
    // Pitch from zero crossings over the steady middle part of the tone.
    const middle = samples.slice(Math.floor(samples.length * 0.3), Math.floor(samples.length * 0.7));
    let crossings = 0;
    for (let i = 1; i < middle.length; i++) if ((middle[i - 1] < 0) !== (middle[i] < 0)) crossings++;
    const pitch = crossings / 2 / (middle.length / 16000);
    const rms = Math.sqrt(middle.reduce((sum, value) => sum + value * value, 0) / middle.length);
    return { ok: outcome.ok, count: samples.length, pitch: Math.round(pitch), rms: Math.round(rms * 1000) / 1000, nativeRate: new AudioContext().sampleRate,
      sharedStillRunning: shared ? shared.state === "running" : null };
  }, shareContext);
  for (const shareContext of [false, true]) {
  const result = await run(shareContext);
  console.log(JSON.stringify({ shareContext, ...result }));
  if (shareContext) assert.equal(result.sharedStillRunning, true, "the shared page context stays open for playback");
  assert.equal(result.ok, true);
  // About 1 s of audio (plus capture start-up and the final flush), delivered at 16 kHz.
  assert.ok(result.count > 13000 && result.count < 22000, `16 kHz sample count, got ${result.count}`);
  assert.ok(Math.abs(result.pitch - 440) < 15, `pitch preserved, got ${result.pitch} Hz`);
  assert.ok(result.rms > 0.2 && result.rms < 0.45, `level preserved (0.5 sine ≈ 0.35 RMS), got ${result.rms}`);
  }
  console.log("PASS realtime capture: native-rate context delivers 16 kHz PCM with the right length, pitch and level");
} finally {
  await browser.close();
}
