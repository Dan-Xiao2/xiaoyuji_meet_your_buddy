import test from "node:test";
import assert from "node:assert/strict";
import { createConversationController } from "../src/features/conversation/conversationController.js";
import { createVoiceSession } from "../src/features/voice/voiceSession.js";

test("quick reply sentences reach the page while the turn is current, and stop once it is replaced", async () => {
  const sentences = [];
  let emit, finish;
  const quickApi = (_, { onSentence }) => { emit = onSentence; return new Promise(resolve => { finish = resolve; }); };
  const controller = createConversationController({ quickApi });
  const state = { profile: { name: "虚构" }, family: {}, session: { id: "s", status: "active", turnCount: 0 }, messages: [], board: { type: "blank" }, memory: {}, studentModel: {} };
  const turn = controller.begin();
  let live = state;
  const run = controller.run({ turn, input: "蜗牛", stateForRequest: state, localTurn: { ...state, messages: [{ role: "child", text: "蜗牛", id: `${turn.turnId}:child`, turnId: turn.turnId }, { role: "tutor", text: "本地", id: `${turn.turnId}:tutor`, turnId: turn.turnId }] },
    getState: () => live, onPending: commit => { const applied = controller.accept(turn, live, commit); live = applied.state; return live; },
    onQuickReply: () => false, onQuickSentence: text => sentences.push(text) });
  await new Promise(resolve => setImmediate(resolve));
  emit("第一句。");
  controller.begin(); // a new turn replaces this one
  emit("迟到的第二句。");
  assert.deepEqual(sentences, ["第一句。"]);
  finish({ reply: "第一句。", llmStatus: { used: true } });
  await run;
});

function harness() {
  const context = { sessionId: "one", active: true, canListen: true, pending: false, bargeIn: true };
  const sinks = [], timings = [], interrupted = [], watches = [];
  const voice = { recordingSupported: true, preparePlayback() {}, stopListening() {}, stopSpeaking() {}, finishListening() {},
    listen() {}, speak() { return true; }, prefetchSpeech() {},
    speakSentences(callbacks) { const sink = { callbacks, pushed: [], ended: false, push(t) { this.pushed.push(t); }, end() { this.ended = true; } }; sinks.push(sink); return sink; },
    watchForBargeIn(onBargeIn) { const watch = { onBargeIn, stop() {} }; watches.push(watch); return watch; } };
  const session = createVoiceSession({ voice, getContext: () => context, onInput() {}, onTiming: item => timings.push(item.stage), onLevel() {},
    onBargeIn: id => interrupted.push(id),
    ui: { beforeListen() {}, captureStart() {}, transcript() {}, captureError() {}, clearSpeechError() {}, speechError() {} },
    narration: { stop() {}, prepare() {}, step() {}, replay() {} },
    clock: { now: () => 0, setTimeout: () => 1, clearTimeout() {} } });
  return { session, sinks, timings, interrupted, watches };
}

test("a streamed reply plays as sentences arrive, links to its message once committed, and resumes listening at the end", () => {
  const h = harness();
  const reply = h.session.playStreamingReply();
  reply.push("蜗牛背着小房子。");
  reply.push("它爬过的地方亮晶晶的。");
  const sink = h.sinks[0];
  assert.deepEqual(sink.pushed, ["蜗牛背着小房子。", "它爬过的地方亮晶晶的。"]);
  sink.callbacks.onStart();
  assert.equal(h.session.getSnapshot().output, "playing");
  reply.attach("turn-1:tutor");
  h.watches[0].onBargeIn();
  assert.deepEqual(h.interrupted, ["turn-1:tutor"], "an interruption marks the reply attached after playback began");
});

test("ending, cancelling and replacing a streamed reply", () => {
  const h = harness();
  h.session.beginInput(); // the child has started talking, so listening resumes after replies
  const reply = h.session.playStreamingReply();
  reply.push("一句。");
  reply.end();
  assert.equal(h.sinks[0].ended, true);
  reply.push("晚到的一句。");
  assert.deepEqual(h.sinks[0].pushed, ["一句。"], "nothing is added after the end");
  h.sinks[0].callbacks.onStart(); h.sinks[0].callbacks.onEnd();
  assert.equal(h.session.getSnapshot().output, "idle");
  assert.equal(h.session.getSnapshot().scheduled, true, "listening resumes after the streamed reply");

  const stale = h.session.playStreamingReply();
  h.session.playStreamingReply(); // a newer reply replaces it
  stale.push("旧回答。");
  assert.deepEqual(h.sinks[1].pushed, [], "a replaced playback ignores later sentences");

  const cancelled = harness();
  const rejected = cancelled.session.playStreamingReply();
  rejected.push("被拒绝的回答。");
  cancelled.sinks[0].callbacks.onStart();
  rejected.cancel();
  assert.equal(cancelled.session.getSnapshot().output, "idle");
});
