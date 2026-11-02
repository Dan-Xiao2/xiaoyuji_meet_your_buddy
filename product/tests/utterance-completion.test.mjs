import test from "node:test";
import assert from "node:assert/strict";
import { looksUnfinished, joinUtterance } from "../src/features/voice/utteranceCompletion.js";
import { createVoiceSession } from "../src/features/voice/voiceSession.js";

test("only clearly mid-thought transcripts count as unfinished", () => {
  for (const text of ["其实，嗯，", "其实嗯。", "我昨天去公园，然后", "我想画一个，", "因为", "还有……", "我看到了小狗和"]) assert.equal(looksUnfinished(text), true, text);
  for (const text of ["天空为什么是蓝色的？", "我要那个。", "好啊", "我想画画。", "不是这个", "", "嗯？"]) assert.equal(looksUnfinished(text), false, text);
});

test("held fragments join with a pause mark", () => {
  assert.equal(joinUtterance("其实，嗯，", "我看到一只蜗牛。"), "其实，嗯，我看到一只蜗牛。");
  assert.equal(joinUtterance("我昨天去公园然后。", "看到了小狗"), "我昨天去公园然后，看到了小狗");
  assert.equal(joinUtterance("", "你好"), "你好");
});

function session() {
  const context = { sessionId: "one", active: true, canListen: true, pending: false };
  const captures = [], inputs = [], timings = [], transcripts = [];
  const voice = { recordingSupported: true, preparePlayback() {}, stopListening() {}, stopSpeaking() {}, finishListening() {},
    listen(callbacks) { captures.push(callbacks); }, speak() { return true; }, prefetchSpeech() {} };
  const voiceSession = createVoiceSession({ voice, getContext: () => context, onInput: text => inputs.push(text),
    onTiming: item => timings.push(item.stage), onLevel() {},
    ui: { beforeListen() {}, captureStart() {}, transcript: text => transcripts.push(text), captureError() {}, clearSpeechError() {}, speechError() {} },
    narration: { stop() {}, prepare() {}, step() {}, replay() {} },
    clock: { now: () => 0, setTimeout: () => 1, clearTimeout() {} } });
  return { voiceSession, captures, inputs, timings, transcripts };
}

test("a half sentence is held, the child is listened to again, and the whole sentence is answered once", () => {
  const h = session();
  h.voiceSession.beginInput();
  h.captures[0].onEnd("其实，嗯，");
  assert.deepEqual(h.inputs, [], "no answer to a half sentence");
  assert.equal(h.captures.length, 2, "listening again at once");
  assert.equal(h.captures[1].noSpeechTimeoutMs, 4000, "waiting for the rest is short");
  h.captures[1].onStart();
  assert.equal(h.transcripts.at(-1), "我在听，你接着说。");
  h.captures[1].onEnd("我在公园看到了一只蜗牛。");
  assert.deepEqual(h.inputs, ["其实，嗯，我在公园看到了一只蜗牛。"]);
  assert.ok(h.timings.includes("utterance-held"));
});

test("if nothing more is said, the held words are answered; holding stops after two pauses", () => {
  const quiet = session();
  quiet.voiceSession.beginInput();
  quiet.captures[0].onEnd("我昨天去公园，然后");
  quiet.captures[1].onIdle();
  assert.deepEqual(quiet.inputs, ["我昨天去公园，然后"]);
  assert.equal(quiet.timings.includes("capture-idle"), false, "a held sentence ending in silence is not a failure");
  quiet.captures[1].onEnd("迟到的结果");
  assert.equal(quiet.inputs.length, 1, "late callbacks are ignored");

  const many = session();
  many.voiceSession.beginInput();
  many.captures[0].onEnd("我，");
  many.captures[1].onEnd("就是，");
  many.captures[2].onEnd("然后");
  assert.deepEqual(many.inputs, ["我，就是，然后"], "after two holds the sentence is answered anyway");

  const stopped = session();
  stopped.voiceSession.beginInput();
  stopped.captures[0].onEnd("因为");
  stopped.voiceSession.pause();
  stopped.voiceSession.beginInput();
  stopped.captures.at(-1).onEnd("新的一句话。");
  assert.deepEqual(stopped.inputs, ["新的一句话。"], "stopping drops a held fragment");
});
