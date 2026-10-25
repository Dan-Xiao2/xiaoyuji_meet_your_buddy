import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage();
  await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto(process.env.TEST_URL || "http://localhost:4173/");
  const result = await page.evaluate(async () => {
    const { createVoiceController } = await import("/src/services/voiceService.js");
    const source = new AudioContext(); await source.resume();
    const destination = source.createMediaStreamDestination();
    const oscillator = source.createOscillator(), gain = source.createGain();
    gain.gain.value = 0; oscillator.connect(gain).connect(destination); oscillator.start();
    navigator.mediaDevices.getUserMedia = async () => destination.stream;
    const oldFetch = window.fetch; let payload;
    window.fetch = async (url, options) => {
      if (url !== "/api/transcribe") throw new Error("Unexpected API");
      payload = JSON.parse(options.body);
      return new Response(JSON.stringify({ text: "虚构测试", latencyMs: 1 }), { status: 200 });
    };
    const voice = createVoiceController();
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("capture timed out")), 10000);
        voice.listen({ preferRecorder: true, onStart() {
          // Real browser container with a long silent prefix, then a synthetic tone.
          gain.gain.setValueAtTime(0.2, source.currentTime + 2);
          gain.gain.setValueAtTime(0, source.currentTime + 2.7);
        }, onEnd(text) { clearTimeout(timeout); resolve(text); }, onError(error) { clearTimeout(timeout); reject(new Error(error)); } });
      });
      const bytes = Uint8Array.from(atob(payload.audioBase64), char => char.charCodeAt(0));
      const decoded = await source.decodeAudioData(bytes.buffer);
      const samples = decoded.getChannelData(0);
      let first = samples.findIndex(sample => Math.abs(sample) > 0.02);
      return { type: payload.mimeType, seconds: decoded.duration, toneStartsAt: first / decoded.sampleRate };
    } finally { voice.stopListening(); oscillator.stop(); await source.close(); window.fetch = oldFetch; }
  });
  assert.equal(result.type, "audio/wav");
  assert.ok(result.seconds > 1.5 && result.seconds < 3.3, JSON.stringify(result));
  assert.ok(result.toneStartsAt > 0.4 && result.toneStartsAt < 0.95, JSON.stringify(result));
  console.log("PASS real MediaRecorder -> native decode -> cropped WAV -> native decode", result);
} finally { await browser.close(); }
