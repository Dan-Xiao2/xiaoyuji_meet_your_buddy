import test from "node:test";
import assert from "node:assert/strict";
import { deriveVoiceUiState } from "../src/ui/voiceState.js";
import { createVoiceSession } from "../src/features/voice/voiceSession.js";

function harness() {
  const context = { sessionId: "one", active: true, canListen: true, pending: false };
  const captures = [], speeches = [], inputs = [], phases = [], frames = [], errors = [], events = [];
  const tasks = new Map();
  let nextTimer = 0, stops = 0;
  const voice = {
    recordingSupported: true, preparePlayback() {}, stopListening() { stops++; }, stopSpeaking() { stops++; },
    finishListening() {}, listen(callbacks) { captures.push(callbacks); },
    speak(text, callbacks) { speeches.push({ text, ...callbacks }); return true; }, prefetchSpeech() {}
  };
  const session = createVoiceSession({ voice, trace: (type, data) => events.push({ type, ...data }), getContext: () => context,
    onInput: text => inputs.push(text), onTiming() {}, onLevel() {},
    onChange: () => phases.push([deriveVoiceUiState({ active: context.active, visible: context.canListen, media: session.getSnapshot() }).phase]),
    ui: { beforeListen() {}, captureStart() {},
      transcript() {}, captureError() {}, clearSpeechError() {}, speechError: id => errors.push(id) },
    narration: { stop() {}, prepare() {}, step: index => frames.push(index), replay: () => frames.push("all") },
    clock: { now: () => 100, setTimeout: fn => { tasks.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => tasks.delete(id) }
  });
  return { voice, session, context, captures, speeches, inputs, phases, frames, errors, tasks, events,
    tick() { const pending = [...tasks.values()]; tasks.clear(); pending.forEach(fn => fn()); },
    get stops() { return stops; } };
}

test("one start accepts one utterance; completed reply resumes without waiting for enrichment", () => {
  const h = harness();
  h.session.beginInput();
  const input = h.captures[0];
  input.onEnd("发现一朵花"); input.onEnd("重复回调");
  assert.deepEqual(h.inputs, ["发现一朵花"]);
  h.session.prepareTurn();
  h.session.playReply({ text: "我们一起看看。", replyMessageId: "reply" });
  h.session.schedule(); h.tick();
  assert.equal(h.captures.length, 1, "Preparing output must block auto listening even before the first audio");
  h.speeches[0].onStart();
  assert.deepEqual(h.session.getSnapshot(), { sessionId: "one", input: "idle", output: "playing", autoListen: true, replyMessageId: "reply",
    captureRevision: 4, playbackRevision: 3, scheduled: false, failure: null, readyDetail: "" });
  h.context.enrichmentPending = true;
  h.speeches[0].onEnd(); h.tick();
  assert.equal(h.captures.length, 2);
});

for (const reason of ["pause", "new-input"]) test(`${reason} rejects late capture and playback callbacks`, () => {
  const h = harness();
  h.session.beginInput();
  const oldInput = h.captures[0];
  h.session.prepareTurn();
  h.session.playReply({ text: "旧回答" });
  const oldOutput = h.speeches[0];
  if (reason === "pause") h.session.pause(); else h.session.beginInput();
  const state = h.session.getSnapshot(), phases = h.phases.length;
  oldInput.onStart(); oldInput.onProcessing(); oldInput.onEnd("迟到原话"); oldInput.onError("迟到错误");
  oldOutput.onStart(); oldOutput.onEnd(); oldOutput.onError(); h.tick();
  assert.deepEqual(h.inputs, []);
  assert.deepEqual(h.session.getSnapshot(), state);
  assert.equal(h.phases.length, phases);
});

test("auto-listen rechecks page visibility, session identity and pending work when the timer fires", () => {
  for (const change of [h => { h.context.canListen = false; }, h => { h.context.sessionId = "two"; },
    h => { h.context.active = false; }, h => { h.context.pending = true; }]) {
    const h = harness(); h.session.resume(); change(h); h.tick();
    assert.equal(h.captures.length, 0);
  }
});

test("finishing capture still accepts its final result once, but a pause cancels it", () => {
  const h = harness(); h.session.beginInput(); h.session.finishInput();
  assert.equal(h.session.getSnapshot().input, "processing");
  h.captures[0].onEnd("最后的字");
  assert.deepEqual(h.inputs, ["最后的字"]);
  h.session.beginInput(); h.session.finishInput(); h.session.pause();
  h.captures[1].onEnd("暂停后的字");
  assert.deepEqual(h.inputs, ["最后的字"]);
});

test("speech failure pauses auto-listening and permits an explicit replay", () => {
  const h = harness(); h.session.resume();
  h.session.playReply({ text: "回答", replyMessageId: "r" });
  h.speeches[0].onError(); h.tick();
  assert.equal(h.captures.length, 0);
  assert.deepEqual(h.errors, ["r"]);
  h.session.playReply({ text: "回答", replyMessageId: "r" });
  h.speeches[1].onEnd(); h.tick();
  assert.equal(h.captures.length, 0, "Replay must not silently re-enable continuous listening");
});

test("drawing frames follow speech start; stale segment callbacks cannot advance the next segment", () => {
  const h = harness(); h.session.resume();
  h.session.playReply({ steps: [{ text: "第一步" }, { text: "第二步" }] });
  assert.deepEqual(h.frames, []);
  h.speeches[0].onStart(); h.speeches[0].onEnd();
  h.speeches[0].onEnd(); h.speeches[0].onError();
  assert.equal(h.speeches.length, 2);
  h.speeches[1].onStart(); h.speeches[1].onEnd(); h.tick();
  assert.deepEqual(h.frames, [0, 1]);
  assert.equal(h.captures.length, 1);
});

test("muted narration reveals the whole board and schedules listening without TTS", () => {
  const h = harness(); h.session.resume();
  h.session.playReply({ steps: [{ text: "第一步" }, { text: "第二步" }], enabled: false });
  h.tick();
  assert.deepEqual(h.frames, ["all"]);
  assert.equal(h.speeches.length, 0);
  assert.equal(h.captures.length, 1);
});

test("ended-session farewell never restarts listening; a new session invalidates it", () => {
  const h = harness(); h.session.beginInput(); h.session.pause(); h.context.active = false;
  h.session.acknowledgeEnd("再见");
  h.speeches[0].onStart(); h.speeches[0].onEnd(); h.tick();
  assert.equal(h.captures.length, 1);
  h.session.acknowledgeEnd("再见");
  h.context.sessionId = "two"; h.context.active = true;
  const phases = h.phases.length;
  h.speeches[1].onStart(); h.speeches[1].onEnd();
  assert.equal(h.phases.length, phases);
});


test("synchronous capture failure settles without leaving a listening state", () => {
  const h = harness();
  h.voice.listen = callbacks => callbacks.onError("没有麦克风");
  h.session.beginInput(); h.tick();
  assert.equal(h.session.getSnapshot().input, "idle");
  assert.equal(h.session.getSnapshot().autoListen, false);
  assert.equal(h.phases.at(-1)[0], "retry");
});

test("synchronous speech completion plus false return advances each segment once", () => {
  const h = harness(), spoken = [];
  h.voice.speak = (text, callbacks) => { spoken.push(text); callbacks.onStart(); callbacks.onEnd(); return false; };
  h.session.resume();
  h.session.playReply({ steps: [{ text: "一" }, { text: "二" }] });
  assert.deepEqual(spoken, ["一", "二"]);
  assert.deepEqual(h.frames, [0, 1]);
  h.tick();
  assert.equal(h.captures.length, 1);
});

test("runtime trace explains a blocked resume and exposes a read-only timer snapshot", () => {
  const h = harness(); h.session.resume();
  assert.equal(h.session.getSnapshot().scheduled, true);
  assert.throws(() => { h.session.getSnapshot().input = "playing"; }, TypeError);
  h.context.canListen = false; h.tick();
  assert.equal(h.session.getSnapshot().scheduled, false);
  assert.equal(h.events.at(-1).type, "media.listen-skipped");
  assert.equal(h.events.at(-1).reason, "not-visible");
});

test("late media callbacks retain their original identity and expose no transcript or error text", () => {
  const h = harness(); h.session.beginInput();
  const capture = h.session.getSnapshot().captureRevision;
  h.session.playReply({ text: "私密回答", replyMessageId: "r" });
  const playback = h.session.getSnapshot().playbackRevision;
  h.session.pause();
  const stopped = h.session.getSnapshot();
  h.captures[0].onEnd("私密原话"); h.speeches[0].onError("私密错误");
  assert.deepEqual(h.session.getSnapshot(), stopped);
  const rejected = h.events.filter(e => e.type === "media.callback-rejected");
  assert.ok(rejected.some(e => e.captureRevision === capture));
  assert.ok(rejected.some(e => e.playbackRevision === playback && e.replyMessageId === "r"));
  assert.ok(!JSON.stringify(h.events).includes("私密"));
});

test("a duplicate speech completion is traced and cannot start another segment", () => {
  const h = harness(); h.session.playReply({ text: "回答" });
  h.speeches[0].onStart(); h.speeches[0].onEnd(); h.speeches[0].onEnd();
  assert.equal(h.events.filter(e => e.type === "media.play-ended").length, 1);
  assert.equal(h.events.at(-1).reason, "settled");
});
