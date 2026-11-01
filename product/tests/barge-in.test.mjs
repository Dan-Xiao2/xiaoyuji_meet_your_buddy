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

function fakeAudio(levels) {
  const contexts = [];
  class AudioContextClass {
    constructor() { this.state = "running"; this.closed = false; contexts.push(this); }
    createAnalyser() { return { fftSize: 4, getFloatTimeDomainData: samples => samples.fill(levels.shift() ?? 0) }; }
    createMediaStreamSource() { return { connect() {} }; }
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
    watchForBargeIn(onBargeIn) { const watch = { onBargeIn, stopped: false, stop() { this.stopped = true; } }; watches.push(watch); return watch; }
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
