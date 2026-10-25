import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceController } from "../src/services/voiceService.js";
import { cropRecordedAudio } from "../src/services/recordedAudio.js";

async function withCapture(run, resumeFails = false) {
  const saved = Object.fromEntries(["window", "navigator", "MediaRecorder", "FileReader", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let frame, now = 0, level = 0, recording, uploaded, decodedInput, stopped = false, resumed = false;
  const track = { label: "synthetic microphone", stop() { stopped = true; } };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { recording = this; this.state = "inactive"; this.mimeType = "audio/webm"; }
    chunk(text) { this.ondataavailable({ data: new Blob([text]) }); }
    start() { this.state = "recording"; this.chunk("HEADER|"); }
    stop() { this.state = "inactive"; this.chunk("TAIL"); this.onstop(); }
  }
  class AudioContext {
    state = "suspended";
    async resume() { resumed = true; if (resumeFails) throw new Error("blocked"); this.state = "running"; }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { getFloatTimeDomainData(data) { data.fill(level); } }; }
    async close() { this.state = "closed"; }
  }
  class Reader {
    readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:audio/webm;base64,${Buffer.from(bytes).toString("base64")}`; this.onloadend(); }); }
  }
  class OfflineAudioContext {
    async decodeAudioData(bytes) {
      decodedInput = Buffer.from(bytes).toString();
      return { length: 4000, sampleRate: 1000, numberOfChannels: 1, getChannelData: () => new Float32Array(4000).fill(0.5) };
    }
  }
  const window = { AudioContext, OfflineAudioContext, MediaRecorder: Recorder, isSecureContext: true, location: { hostname: "localhost" },
    performance: { now: () => now }, setTimeout, clearTimeout, requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() { frame = null; } };
  const values = { window, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } },
    MediaRecorder: Recorder, FileReader: Reader, fetch: async (_url, options) => { uploaded = JSON.parse(options.body); return { ok: true, json: async () => ({ text: "虚构转写", latencyMs: 1 }) }; } };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const voice = createVoiceController();
  try {
    await run({ voice, tick(value, elapsed = 20) { level = value; now += elapsed; frame?.(); }, chunk: text => recording.chunk(text),
      disconnect: () => track.onended?.(),
      get uploaded() { return uploaded; }, get decodedInput() { return decodedInput; }, get stopped() { return stopped; }, get resumed() { return resumed; } });
  } finally {
    voice.stopListening();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("disconnected conversation microphone stops capture without uploading partial audio", async () => {
  await withCapture(async harness => {
    let error;
    harness.voice.listen({ preferRecorder: true, onError: value => { error = value; } });
    await settle();
    harness.disconnect();
    await settle();
    assert.match(error, /麦克风已断开/);
    assert.equal(harness.stopped, true);
    assert.equal(harness.uploaded, undefined);
  });
});

test("recording preserves every container chunk across a wait before speaking", async () => {
  await withCapture(async harness => {
    let started = false, result;
    harness.voice.listen({ preferRecorder: true, onStart: () => { started = true; }, onEnd: text => { result = text; } });
    await settle();
    assert.equal(started, true); assert.equal(harness.resumed, true);
    for (let i = 0; i < 8; i++) { harness.chunk(`idle${i}|`); harness.tick(0, 250); }
    for (let i = 0; i < 4; i++) harness.tick(0.05);
    harness.chunk("speech|");
    harness.voice.finishListening();
    await settle(); await settle();
    assert.equal(harness.decodedInput, "HEADER|idle0|idle1|idle2|idle3|idle4|idle5|idle6|idle7|speech|TAIL");
    assert.equal(harness.uploaded.mimeType, "audio/wav");
    const wav = Buffer.from(harness.uploaded.audioBase64, "base64");
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.ok(wav.length < 44 + 4000 * 2, "leading wait must be removed after decoding");
    assert.equal(result, "虚构转写"); assert.equal(harness.stopped, true);
  });
});

test("native decoding crops at sample boundaries and writes signed mono PCM", async () => {
  class Decoder { async decodeAudioData() { return { length: 4, sampleRate: 1000, numberOfChannels: 1,
    getChannelData: () => new Float32Array([0, 0.25, -1, 1]) }; } }
  const wav = Buffer.from(await (await cropRecordedAudio(new Blob(["container"]), 2, Decoder)).arrayBuffer());
  assert.equal(wav.length, 48); assert.equal(wav.readUInt32LE(24), 1000);
  assert.equal(wav.readInt16LE(44), -32768); assert.equal(wav.readInt16LE(46), 32767);
  class BrokenDecoder { async decodeAudioData() { throw new Error("invalid container"); } }
  await assert.rejects(cropRecordedAudio(new Blob(["bad"]), 0, BrokenDecoder), /invalid container/);
});

test("failed audio input activation reports error, never claims to be listening", async () => {
  await withCapture(async harness => {
    let started = false, error;
    harness.voice.listen({ preferRecorder: true, onStart: () => { started = true; }, onError: value => { error = value; } });
    await settle();
    assert.equal(started, false); assert.match(error, /声音检测/);
    assert.equal(harness.stopped, true); assert.equal(harness.uploaded, undefined);
  }, true);
});

test("ending before speech uploads nothing and does not create a transcript", async () => {
  await withCapture(async harness => {
    let result;
    harness.voice.listen({ preferRecorder: true, onEnd: text => { result = text; } });
    await settle(); harness.voice.finishListening(); await settle();
    assert.equal(result, ""); assert.equal(harness.uploaded, undefined);
  });
});
