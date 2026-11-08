import test from "node:test";
import assert from "node:assert/strict";
import { getMicrophoneId, setMicrophoneId, openMicrophone, microphoneError } from "../src/services/microphoneInput.js";
import { createVoiceController } from "../src/services/voiceService.js";

test("selected microphone uses exact device, persists locally and never silently falls back", async () => {
  const originals = ["window", "navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const data = new Map(); let constraints, stopped = false, calls = 0, actual = "built-in";
  const track = { getSettings: () => ({ deviceId: actual }), stop() { stopped = true; } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key)
  }, SpeechRecognition: class {}, MediaRecorder: class {}, isSecureContext: true } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
    getUserMedia: async value => { calls++; constraints = value; return { getTracks: () => [track], getAudioTracks: () => [track] }; }
  } } });
  try {
    assert.equal(getMicrophoneId(), "");
    await openMicrophone(); assert.equal(constraints.audio.deviceId, undefined);
    setMicrophoneId("built-in"); await openMicrophone();
    assert.deepEqual(constraints.audio.deviceId, { exact: "built-in" });
    assert.equal(constraints.audio.echoCancellation, true);
    actual = "phone";
    await assert.rejects(openMicrophone(), { name: "OverconstrainedError" });
    assert.equal(stopped, true); assert.equal(calls, 3);
    let error;
    createVoiceController().listen({ onError: value => { error = value; } });
    assert.match(error, /云端语音识别/); assert.equal(calls, 3);
    setMicrophoneId(""); assert.equal(data.size, 0);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("capture errors distinguish missing device, denied permission and hardware failure", () => {
  assert.match(microphoneError({ name: "NotFoundError" }), /重新选择/);
  assert.match(microphoneError({ name: "OverconstrainedError" }), /重新选择/);
  assert.match(microphoneError({ name: "NotAllowedError" }), /权限/);
  assert.match(microphoneError({ name: "NotReadableError" }), /设备连接/);
});

test("a headset microphone is recognised from its track label", async () => {
  const { isHeadsetInput } = await import("../src/services/microphoneInput.js");
  const stream = label => ({ getAudioTracks: () => [{ label }] });
  for (const label of ["AirPods Pro", "Dan的AirPods", "Bluetooth Headset", "蓝牙耳机", "Beats Studio Buds"]) assert.equal(isHeadsetInput(stream(label)), true, label);
  for (const label of ["iPhone 麦克风", "iPhone Microphone", "Default", ""]) assert.equal(isHeadsetInput(stream(label)), false, label);
  assert.equal(isHeadsetInput(null), false);
});

test("adult captions are off unless turned on, and the choice stays on this device", async () => {
  const { getCaptionsEnabled, setCaptionsEnabled } = await import("../src/services/microphoneInput.js");
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const data = new Map();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) } } });
  try {
    assert.equal(getCaptionsEnabled(), false);
    setCaptionsEnabled(true); assert.equal(getCaptionsEnabled(), true);
    setCaptionsEnabled(false); assert.equal(getCaptionsEnabled(), false);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original); else delete globalThis.window;
  }
});
