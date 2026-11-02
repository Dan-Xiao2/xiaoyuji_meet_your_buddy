import test from "node:test";
import assert from "node:assert/strict";
import { createBargeInDetector, startBargeInMonitor } from "../src/services/bargeIn.js";
import { createVoiceSession } from "../src/features/voice/voiceSession.js";

const feed = (detector, levels, start = 0, step = 20) => levels.map((level, index) => detector.update(level, start + index * step));

test("detector ignores Xiaoyu's own leaked voice measured during warm-up", () => {
  const detector = createBargeInDetector({ warmupMs: 500, minSpeechMs: 300, absolute: 0.035, ratio: 1.6 });
  // 0.05 echo leak during warm-up raises the threshold to 0.08; the same leak afterwards is ignored.
  const results = feed(detector, [...Array(25).fill(0.05), ...Array(40).fill(0.05)]);
  assert.equal(results.some(item => item.triggered), false);
});

test("detector triggers on sustained speech clearly above the leak, once, tolerating syllable gaps", () => {
  const detector = createBargeInDetector({ warmupMs: 500, minSpeechMs: 300, absolute: 0.035, ratio: 1.6, gapMs: 80 });
  feed(detector, Array(25).fill(0.01));
  // 0.2 speech with a one-frame dip (20 ms) between syllables.
  const speech = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.001, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2];
  const results = feed(detector, speech, 500);
  assert.equal(results.filter(item => item.triggered).length, 1);
  assert.equal(detector.update(0.3, 2000).triggered, false, "only the first trigger counts");
});

test("detector does not trigger on short sounds or speech broken by real pauses", () => {
  const detector = createBargeInDetector({ warmupMs: 0, minSpeechMs: 300, gapMs: 80 });
  const clap = [0.4, 0.4, 0.4, ...Array(10).fill(0)];
  const broken = Array.from({ length: 6 }, () => [0.2, 0.2, 0.2, 0.2, 0.2, 0, 0, 0, 0, 0, 0]).flat();
  assert.equal(feed(detector, [...clap, ...broken]).some(item => item.triggered), false);
});

// Without echo cancellation Xiaoyu leaks into the microphone at a fixed share of what is playing.
const feedWithPlayback = (detector, frames, start = 0, step = 20) => frames.map(([mic, out], index) => detector.update(mic, start + index * step, out));

test("with a playback reference, leaked speech that gets louder after warm-up does not trigger", () => {
  // Xiaoyu starts softly, then speaks louder; the microphone hears 40 % of the output.
  const speech = Array.from({ length: 150 }, (_, i) => { const out = i < 30 ? 0.05 : 0.05 + 0.25 * Math.abs(Math.sin(i / 7)); return [out * 0.4, out]; });
  assert.equal(feedWithPlayback(createBargeInDetector({ warmupMs: 500, minSpeechMs: 300 }), speech).some(item => item.triggered), false);
  // Without the reference (warm-up leak only), the same leak is mistaken for the child.
  const unreferenced = createBargeInDetector({ warmupMs: 500, minSpeechMs: 300 });
  assert.equal(speech.some(([mic], index) => unreferenced.update(mic, index * 20).triggered), true);
});

test("with a playback reference, a child speaking over Xiaoyu or in a pause triggers", () => {
  const over = createBargeInDetector({ warmupMs: 500, minSpeechMs: 300 });
  const warm = Array.from({ length: 25 }, () => [0.04, 0.1]);
  const child = Array.from({ length: 20 }, () => [0.04 + 0.2, 0.1]);
  assert.equal(feedWithPlayback(over, [...warm, ...child]).filter(item => item.triggered).length, 1);

  const gap = createBargeInDetector({ warmupMs: 500, minSpeechMs: 300 });
  const pause = Array.from({ length: 30 }, () => [0.002, 0]); // between sentences: nothing playing
  const quietChild = Array.from({ length: 20 }, () => [0.06, 0]);
  assert.equal(feedWithPlayback(gap, [...warm, ...pause, ...quietChild]).some(item => item.triggered), true);
});

// Levels measured on an iPhone with the raw microphone (pilot, 2026-11-02): Xiaoyu's output 0.1–0.35,
// about 2 % of it leaking in, a quiet room near 0.0015, the child at roughly 0.008–0.012 RMS.
function pilotScene({ childFrom = null, childLevel = 0.006, clatterAt = null } = {}) {
  return Array.from({ length: 500 }, (_, i) => {
    const out = 0.1 + 0.25 * Math.abs(Math.sin(i / 6));
    let mic = 0.0015 + 0.0005 * Math.abs(Math.sin(i * 1.7)) + 0.02 * out;
    if (childFrom !== null && i >= childFrom) mic += childLevel * (0.75 + 0.25 * Math.abs(Math.sin(i / 3))); // syllables (≈0.006 → mic peak 0.014, as measured)
    if (clatterAt !== null && i >= clatterAt && i < clatterAt + 5) mic += 0.03; // a cup put down, 100 ms
    return [mic, out];
  });
}
const rawPilot = () => createBargeInDetector({ absolute: 0.004, gapMs: 150 });

test("pilot levels: the raw-microphone settings hear the child, and the old floor did not", () => {
  assert.equal(feedWithPlayback(rawPilot(), pilotScene({ childFrom: 200 })).some(item => item.triggered), true);
  assert.equal(feedWithPlayback(createBargeInDetector({ absolute: 0.012 }), pilotScene({ childFrom: 200 })).some(item => item.triggered), false,
    "with the old 0.012 floor the child at pilot levels never interrupts, as seen on the iPhone");
});

test("pilot levels: Xiaoyu alone or a short clatter does not interrupt", () => {
  assert.equal(feedWithPlayback(rawPilot(), pilotScene()).some(item => item.triggered), false);
  assert.equal(feedWithPlayback(rawPilot(), pilotScene({ clatterAt: 250 })).some(item => item.triggered), false);
});

function fakeAudio(levels) {
  const contexts = [];
  class AudioContextClass {
    constructor() { this.state = "running"; this.closed = false; contexts.push(this); }
    createAnalyser() { return { fftSize: 4, getFloatTimeDomainData: samples => samples.fill(levels.shift() ?? 0) }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    close() { this.closed = true; this.state = "closed"; return Promise.resolve(); }
  }
  const stream = () => { const track = { stopped: false, stop() { this.stopped = true; } }; return { track, getTracks: () => [track] }; };
  return { AudioContextClass, contexts, stream };
}

test("monitor hands the open stream over on a trigger, and releases it when stopped instead", async () => {
  const audio = fakeAudio([...Array(30).fill(0.01), ...Array(30).fill(0.3)]);
  let clock = 0, handed = null;
  const opened = audio.stream();
  const monitor = startBargeInMonitor({ openStream: async () => opened, AudioContextClass: audio.AudioContextClass,
    onTrigger: stream => { handed = stream; }, now: () => (clock += 20), requestFrame: fn => { queueMicrotask(fn); return 1; }, cancelFrame() {} });
  await monitor.ready;
  for (let i = 0; i < 80 && !handed; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(handed, opened);
  assert.equal(opened.track.stopped, false, "a handed-over stream stays open for the capture that follows");
  assert.equal(audio.contexts[0].closed, true);

  const idle = fakeAudio([]), idleStream = idle.stream();
  const stopped = startBargeInMonitor({ openStream: async () => idleStream, AudioContextClass: idle.AudioContextClass,
    onTrigger: () => assert.fail("must not trigger"), now: () => 0, requestFrame: () => 1, cancelFrame() {} });
  await stopped.ready; stopped.stop();
  assert.equal(idleStream.track.stopped, true);
});

test("a shared page context is used but never closed, so playback keeps working", async () => {
  const audio = fakeAudio([]), stream = audio.stream();
  const shared = new audio.AudioContextClass();
  const monitor = startBargeInMonitor({ openStream: async () => stream, AudioContextClass: audio.AudioContextClass, context: shared,
    onTrigger: () => assert.fail("must not trigger"), now: () => 0, requestFrame: () => 1, cancelFrame() {} });
  await monitor.ready; monitor.stop();
  assert.equal(audio.contexts.length, 1, "no private context was created");
  assert.equal(shared.closed, false);
  assert.equal(stream.track.stopped, true);
});

test("monitor reports how detection went exactly once: stopped, triggered or failed to open", async () => {
  const reports = [];
  const quiet = fakeAudio([]);
  const stopped = startBargeInMonitor({ openStream: async () => quiet.stream(), AudioContextClass: quiet.AudioContextClass,
    onTrigger() {}, onEnd: (stats, reason) => reports.push(reason), now: () => 0, requestFrame: () => 1, cancelFrame() {} });
  await stopped.ready; stopped.stop(); stopped.stop();
  const failing = startBargeInMonitor({ openStream: async () => { throw new Error("denied"); }, AudioContextClass: quiet.AudioContextClass,
    onTrigger() {}, onEnd: (stats, reason) => reports.push(reason) });
  await failing.ready; failing.stop();
  let clock = 0;
  const loud = fakeAudio([...Array(30).fill(0.01), ...Array(30).fill(0.3)]);
  const triggered = startBargeInMonitor({ openStream: async () => loud.stream(), AudioContextClass: loud.AudioContextClass,
    onTrigger() {}, onEnd: (stats, reason) => reports.push(`${reason}:${stats.bestMargin >= 1}`), now: () => (clock += 20), requestFrame: fn => { queueMicrotask(fn); return 1; }, cancelFrame() {} });
  await triggered.ready;
  for (let i = 0; i < 80 && reports.length < 3; i++) await new Promise(resolve => setImmediate(resolve));
  triggered.stop();
  assert.deepEqual(reports, ["stopped", "open-failed", "triggered:true"]);
});

test("monitor stopped before the microphone opens releases the late stream and never runs", async () => {
  const audio = fakeAudio([]), late = audio.stream();
  let release;
  const monitor = startBargeInMonitor({ openStream: () => new Promise(resolve => { release = () => resolve(late); }),
    AudioContextClass: audio.AudioContextClass, onTrigger: () => assert.fail("must not trigger") });
  monitor.stop();
  release(); await monitor.ready;
  assert.equal(late.track.stopped, true);
  assert.equal(audio.contexts.length, 0);
});

function session({ bargeIn = true } = {}) {
  const context = { sessionId: "one", active: true, canListen: true, pending: false, bargeIn };
  const captures = [], speeches = [], timings = [], watches = [];
  const voice = {
    recordingSupported: true, preparePlayback() {}, stopListening() {}, stopSpeaking() {}, finishListening() {},
    listen(callbacks) { captures.push(callbacks); },
    speak(text, callbacks) { speeches.push(callbacks); return true; }, prefetchSpeech() {},
    watchForBargeIn(onBargeIn, options = {}) { const watch = { onBargeIn, options, stopped: false, stop() { this.stopped = true; } }; watches.push(watch); return watch; }
  };
  let now = 1000;
  const voiceSession = createVoiceSession({ voice, getContext: () => context, onInput() {}, onTiming: item => timings.push(item), onLevel() {},
    ui: { beforeListen() {}, captureStart() {}, transcript() {}, captureError() {}, clearSpeechError() {}, speechError() {} },
    narration: { stop() {}, prepare() {}, step() {}, replay() {} },
    clock: { now: () => now, setTimeout: () => 1, clearTimeout() {} } });
  return { voiceSession, context, captures, speeches, timings, watches, advance: ms => { now += ms; } };
}

test("speaking over a playing reply stops it, listens, and records when it happened", () => {
  const h = session();
  h.voiceSession.playReply({ text: "蜗牛背着小房子。", replyMessageId: "reply" });
  h.speeches[0].onStart();
  assert.equal(h.watches.length, 1);
  h.advance(1200);
  h.watches[0].onBargeIn();
  assert.equal(h.voiceSession.getSnapshot().output, "idle");
  assert.equal(h.voiceSession.getSnapshot().input, "capturing");
  assert.equal(h.captures.length, 1);
  assert.deepEqual(h.timings.filter(item => item.stage === "barge-in"), [{ stage: "barge-in", latencyMs: 1200 }]);
  h.captures[0].onEnd("");
  assert.ok(h.timings.some(item => item.stage === "barge-in-empty"), "an interruption that hears nothing is counted");
  assert.ok(h.timings.some(item => item.stage === "capture-empty"), "hearing nothing is counted for the pilot");
  h.watches[0].options.onEnd({ micPeak: 0.05, bestMargin: 1.2 }, "triggered");
  assert.ok(h.timings.some(item => item.stage === "barge-in-watch" && item.reason === "triggered" && item.levels.micPeak === 0.05),
    "how detection went is reported, as numbers only");
});

test("no barge-in watch when disabled or for a farewell; any stop of playback ends the watch", () => {
  const off = session({ bargeIn: false });
  off.voiceSession.playReply({ text: "好的。" }); off.speeches[0].onStart();
  assert.equal(off.watches.length, 0);
  const bye = session();
  bye.voiceSession.acknowledgeEnd("再见啦。"); bye.speeches[0].onStart();
  assert.equal(bye.watches.length, 0);
  const h = session();
  h.voiceSession.playReply({ text: "第一句。" }); h.speeches[0].onStart();
  h.voiceSession.pause();
  assert.equal(h.watches[0].stopped, true);
  h.watches[0].onBargeIn();
  assert.equal(h.captures.length, 0, "a late trigger after playback stopped does nothing");
  h.voiceSession.playReply({ text: "第二句。" }); h.speeches[1].onStart(); h.speeches[1].onEnd();
  assert.equal(h.watches[1].stopped, true, "playback finishing ends the watch");
  assert.ok(!h.timings.some(item => item.stage === "barge-in-empty"), "a normal capture is not counted as an interruption");
});

test("with retracking the coupling follows the echo canceller down, never up", () => {
  const settings = { warmupMs: 500, absolute: 0.001, ratio: 2, retrackMs: 1000 };
  const run = (detector, from, to, mic) => { for (let now = from; now < to; now += 16) detector.update(mic, now, 0.2); };
  const converging = createBargeInDetector(settings);
  run(converging, 0, 520, 0.008); // warm-up: the canceller has not converged yet, 4 % leaks through
  assert.equal(converging.stats().coupling, 0.04);
  run(converging, 520, 3000, 0.002); // converged: 1 %
  assert.equal(converging.stats().coupling, 0.01);
  // A louder stretch that is not the child (1.5 %, under the 2 × 1 % threshold) does not raise it.
  const steady = createBargeInDetector(settings);
  run(steady, 0, 520, 0.002);
  run(steady, 520, 3000, 0.003);
  assert.equal(steady.stats().coupling, 0.01);
});

test("a microphone that delivers pure silence is reopened, at most twice, and reported", async () => {
  const streams = [], meters = [];
  const fakeStream = () => { const track = { stopped: false, muted: streams.length === 0, stop() { this.stopped = true; }, addEventListener() {} };
    const stream = { track, getTracks: () => [track], getAudioTracks: () => [track] }; streams.push(stream); return stream; };
  const context = { state: "running", createMediaStreamSource: () => ({ disconnect() {} }) };
  const frames = [];
  let ended = null;
  const monitor = startBargeInMonitor({ openStream: async () => fakeStream(), context, onTrigger: () => assert.fail("must not trigger"),
    onEnd: (stats, reason) => { ended = { stats, reason }; },
    meter: () => { const meter = { level: () => 0, silent: () => true, stats: () => ({ rawPeak: 0 }), dispose() { this.disposed = true; } }; meters.push(meter); return meter; },
    requestFrame: callback => { frames.push(callback); return frames.length; }, cancelFrame() {} });
  await monitor.ready;
  for (let i = 0; i < 10 && streams.length < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(streams.length, 3, "opened once, then reopened twice");
  assert.equal(streams[0].track.stopped, true); assert.equal(streams[1].track.stopped, true);
  assert.equal(meters[0].disposed, true);
  assert.ok(frames.length >= 1, "after the last reopen it keeps listening instead of reopening again");
  monitor.stop();
  assert.equal(ended.reason, "stopped");
  assert.equal(ended.stats.reopens, 2);
  assert.equal(ended.stats.trackMuted, 1);
  assert.equal(streams[2].track.stopped, true);
});
