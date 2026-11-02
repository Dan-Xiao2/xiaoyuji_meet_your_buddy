// The page's echo canceller with simulated echo: Xiaoyu's playback reaches the microphone delayed,
// with room echo and mild speaker distortion, at about the level of a child's voice (as measured on
// an iPhone in the pilot). Speech-like signals (pitch pulses through formant resonators, syllables
// and pauses) because the canceller has to cope with speech's uneven spectrum, which white noise
// would not test. Real recorded speech was also tried during development (see the change note).
import test from "node:test";
import assert from "node:assert/strict";
import { EchoCanceller, BLOCK, RATE } from "../src/services/echoCancellerWorklet.js";
import { createBargeInDetector } from "../src/services/bargeIn.js";

function random(seed) {
  let state = seed;
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 * 2 - 1; };
}
const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));
const scaled = (values, level) => { const gain = level / rms(values); return values.map((value) => value * gain); };

// gaps: pauses between syllables in seconds; a child's connected speech has only short ones.
function speechLike(seconds, { pitch = 180, seed = 1, gaps = [0.04, 0.16] } = {}) {
  const rand = random(seed), out = new Float32Array(seconds * RATE);
  let n = 0, phase = 0;
  while (n < out.length) {
    const length = Math.round(RATE * (0.15 + 0.15 * Math.abs(rand()))), gap = Math.round(RATE * (gaps[0] + (gaps[1] - gaps[0]) * Math.abs(rand())));
    const formants = [350 + 400 * Math.abs(rand()), 1000 + 1200 * Math.abs(rand())].map((frequency) => ({ c: 2 * 0.9 * Math.cos(2 * Math.PI * frequency / RATE), y1: 0, y2: 0 }));
    const f0 = pitch * (0.85 + 0.3 * Math.abs(rand()));
    for (let i = 0; i < length && n < out.length; i++, n++) {
      phase += f0 / RATE;
      let value = (phase >= 1 ? 1 : 0) + 0.3 * rand();
      if (phase >= 1) phase -= 1;
      for (const formant of formants) { const y = value + formant.c * formant.y1 - 0.81 * formant.y2; formant.y2 = formant.y1; formant.y1 = y; value = y; }
      out[n] = value * Math.sin(Math.PI * i / length);
    }
    n += gap;
  }
  return out;
}

function room({ delayMs, rt60, seed = 3 }) {
  const rand = random(seed), start = Math.round(delayMs * RATE / 1000), h = new Float32Array(start + Math.round(rt60 * RATE));
  h[start] = 1; h[start + 23] = 0.5; h[start + 61] = -0.35; h[start + 97] = 0.25;
  for (let k = start + 1; k < h.length; k++) h[k] += 0.25 * rand() * Math.exp(-6.9 * (k - start) / (rt60 * RATE));
  return h;
}

function convolve(signal, h) {
  const taps = []; h.forEach((value, k) => { if (value) taps.push([k, value]); });
  const out = new Float32Array(signal.length);
  for (let n = 0; n < signal.length; n++) { let sum = 0; for (const [k, value] of taps) { if (k > n) break; sum += value * signal[n - k]; } out[n] = sum; }
  return out;
}

const playback = scaled(speechLike(10), 0.15);
const echoes = new Map(); // convolution is the slow part; each room is computed once
function scene({ delayMs = 60, rt60 = 0.35, leak = 0.006, child = null, noise = 0.0008, state } = {}) {
  const key = `${delayMs}/${rt60}/${leak}`;
  if (!echoes.has(key)) echoes.set(key, scaled(convolve(playback.map((value) => Math.tanh(value)), room({ delayMs, rt60 })), leak)); // mild distortion
  const echo = echoes.get(key), rand = random(9);
  const mic = echo.map((value) => value + noise * rand());
  if (child) mic.forEach((_, i) => { const k = i - child.at * RATE; if (k >= 0 && k < child.voice.length) mic[i] += child.voice[k]; });
  const canceller = new EchoCanceller(state), residual = new Float32Array(mic.length);
  for (let i = 0; i + BLOCK <= mic.length; i += BLOCK) residual.set(canceller.processBlock(mic.subarray(i, i + BLOCK), playback.subarray(i, i + BLOCK)), i);
  const span = (values, from, to) => values.subarray(from * RATE, to * RATE);
  const reduction = (from, to) => 20 * Math.log10(rms(span(echo, from, to)) / rms(span(residual, from, to)));
  return { canceller, mic, residual, echo, reduction, span };
}

test("removes most of Xiaoyu's echo once it has heard her for a few seconds", () => {
  for (const setting of [{ delayMs: 20, rt60: 0.2 }, { delayMs: 60, rt60: 0.35 }, { delayMs: 150, rt60: 0.5 }]) {
    const { canceller, reduction } = scene(setting);
    assert.ok(reduction(4, 10) > 10, `${JSON.stringify(setting)}: ${reduction(4, 10).toFixed(1)} dB`);
    const delayMs = canceller.delay / (RATE / 1000);
    assert.ok(Math.abs(delayMs - setting.delayMs) <= 40, `delay found ${delayMs} ms, true ${setting.delayMs} ms`);
  }
});

test("keeps the child's voice while removing the echo", () => {
  const voice = scaled(speechLike(1.5, { pitch: 300, seed: 5, gaps: [0.01, 0.04] }), 0.007);
  const { residual, span } = scene({ child: { at: 6, voice } });
  const kept = 20 * Math.log10(rms(span(residual, 6, 7.5)) / rms(voice));
  assert.ok(Math.abs(kept) < 3, `child's level changed by ${kept.toFixed(1)} dB`);
});

test("starts the next reply from what it learnt about the room", () => {
  const first = scene();
  const second = scene({ state: first.canceller.state() });
  assert.ok(second.reduction(0.2, 1.5) > 8, `first second of the next reply: ${second.reduction(0.2, 1.5).toFixed(1)} dB`);
  assert.ok(first.reduction(0.2, 1.5) < second.reduction(0.2, 1.5));
});

test("with the page's settings Xiaoyu's echo does not interrupt her, and a child does", () => {
  const settings = { absolute: 0.004, gapMs: 150, ratio: 2, couplingPercentile: 0.9, retrackMs: 1000 };
  const levels = (values) => Array.from({ length: Math.floor(values.length / BLOCK) }, (_, b) => rms(values.subarray(b * BLOCK, (b + 1) * BLOCK)));
  const triggerAt = (residual, options = settings) => {
    const detector = createBargeInDetector(options), heard = levels(residual), played = levels(playback);
    for (let b = 0; b < heard.length; b++) if (detector.update(heard[b], b * 16, played[b]).triggered) return b * 16 / 1000;
    return null;
  };
  const voice = scaled(speechLike(1.5, { pitch: 300, seed: 5, gaps: [0.01, 0.04] }), 0.006);
  let rawFalseStops = 0;
  for (const setting of [{ delayMs: 20, rt60: 0.2 }, { delayMs: 60, rt60: 0.35, leak: 0.008 }, { delayMs: 100, rt60: 0.5 }, { delayMs: 150, rt60: 0.35 }]) {
    const first = scene(setting), state = first.canceller.state();
    assert.equal(triggerAt(first.residual), null, `echo alone, first reply, ${JSON.stringify(setting)}`);
    assert.equal(triggerAt(scene({ ...setting, state }).residual), null, `echo alone, next reply, ${JSON.stringify(setting)}`);
    let at = triggerAt(scene({ ...setting, child: { at: 5, voice } }).residual);
    assert.ok(at !== null && at >= 5 && at - 5 < 0.6, `first reply, child at 5 s, heard at ${at}`);
    // In the next reply the canceller starts from what it learnt, so a child is heard from the start.
    // (In the very first reply of a page, the first ~3 s are still learning and may miss a quiet child.)
    at = triggerAt(scene({ ...setting, state, child: { at: 0.8, voice } }).residual);
    assert.ok(at !== null && at >= 0.8 && at - 0.8 < 0.6, `next reply, child at 0.8 s, heard at ${at}`);
    if (triggerAt(first.mic, { absolute: 0.004, gapMs: 150 }) !== null) rawFalseStops++; // the iPhone pilot's settings
  }
  // Without the canceller the same echo stops Xiaoyu by itself (what happened on the iPhone). With
  // these synthetic voices in one room of four; with recorded speech in about half of all runs.
  assert.ok(rawFalseStops >= 1, `raw microphone stopped Xiaoyu in ${rawFalseStops} of 4 rooms`);
});
