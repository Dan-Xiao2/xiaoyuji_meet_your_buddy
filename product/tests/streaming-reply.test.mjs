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

function harness({ heard = null, duck = false } = {}) {
  const context = { sessionId: "one", active: true, canListen: true, pending: false, bargeIn: true };
  const sinks = [], timings = [], interrupted = [], watches = [], deliveries = [], listens = [], ducks = [], inputs = [];
  let stops = 0;
  const voice = { recordingSupported: true, preparePlayback() {}, stopListening() {}, stopSpeaking() { stops++; }, finishListening() {},
    listen(callbacks) { listens.push(callbacks); }, speak() { return true; }, prefetchSpeech() {}, heardSoFar: () => heard,
    duckPlayback(on) { ducks.push(on); return duck; },
    currentSpeechText: () => sinks.at(-1)?.pushed.join("") || "",
    speakSentences(callbacks) { const sink = { callbacks, pushed: [], ended: false, push(t) { this.pushed.push(t); }, end() { this.ended = true; } }; sinks.push(sink); return sink; },
    watchForBargeIn(onBargeIn) { const watch = { onBargeIn, stop() {} }; watches.push(watch); return watch; } };
  const session = createVoiceSession({ voice, getContext: () => context, onInput: text => inputs.push(text), onTiming: item => timings.push(item.stage), onLevel() {},
    onBargeIn: (id, delivery) => { interrupted.push(id); deliveries.push(delivery); },
    ui: { beforeListen() {}, captureStart() {}, transcript() {}, captureError() {}, clearSpeechError() {}, speechError() {} },
    narration: { stop() {}, prepare() {}, step() {}, replay() {} },
    clock: { now: () => 0, setTimeout: () => 1, clearTimeout() {} } });
  return { session, sinks, timings, interrupted, watches, deliveries, listens, ducks, inputs, stops: () => stops };
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

test("tapping to talk while a reply plays marks that reply as not heard to the end", () => {
  const h = harness();
  const reply = h.session.playStreamingReply();
  reply.push("蜗牛背着小房子。");
  h.sinks[0].callbacks.onStart();
  reply.attach("turn-2:tutor");
  h.session.beginInput();
  assert.deepEqual(h.interrupted, ["turn-2:tutor"]);
  h.session.beginInput();
  assert.deepEqual(h.interrupted, ["turn-2:tutor"], "a tap while nothing plays marks nothing");
});

test("an interruption passes on the whole sentences the child heard; a reply already fully played is not marked", () => {
  let h = harness({ heard: { heard: "蜗牛背着小房子。", complete: false } });
  let reply = h.session.playStreamingReply();
  reply.push("蜗牛背着小房子。"); reply.push("它爬过的地方亮晶晶的。");
  h.sinks[0].callbacks.onStart();
  reply.attach("turn-2:tutor");
  h.watches[0].onBargeIn(); // the child spoke over the second sentence
  assert.deepEqual(h.interrupted, ["turn-2:tutor"]);
  assert.deepEqual(h.deliveries, [{ heard: "蜗牛背着小房子。" }]);

  h = harness({ heard: { heard: "蜗牛背着小房子。", complete: true } });
  reply = h.session.playStreamingReply();
  reply.push("蜗牛背着小房子。"); reply.end();
  h.sinks[0].callbacks.onStart();
  reply.attach("turn-3:tutor");
  h.session.beginInput(); // a tap during the last moment of sound
  assert.deepEqual(h.interrupted, [], "every sentence had been heard");

  h = harness(); // whole-reply playback: which part was heard is unknown
  reply = h.session.playStreamingReply();
  reply.push("蜗牛背着小房子。");
  h.sinks[0].callbacks.onStart();
  reply.attach("turn-4:tutor");
  h.session.beginInput();
  assert.deepEqual(h.deliveries, [{}]);
});

test("a voice interruption only quietens Xiaoyu until a character is heard; a bark lets her carry on", () => {
  const start = (h) => {
    const reply = h.session.playStreamingReply();
    reply.push("蜗牛背着小房子。"); reply.push("它爬过的地方亮晶晶的。");
    h.sinks[0].callbacks.onStart();
    reply.attach("turn-2:tutor");
    return reply;
  };
  // The child: quiet first, then stopped once the recogniser hears a character.
  let h = harness({ duck: true, heard: { heard: "蜗牛背着小房子。", complete: false } });
  start(h);
  const stopsBefore = h.stops();
  h.watches[0].onBargeIn();
  assert.deepEqual(h.ducks, [true]);
  assert.equal(h.stops(), stopsBefore, "still speaking, quietly");
  assert.deepEqual(h.interrupted, []);
  assert.equal(h.listens.length, 1, "listening has started");
  h.listens[0].onHeard();
  assert.ok(h.stops() > stopsBefore, "stopped once the child was heard");
  assert.deepEqual(h.interrupted, ["turn-2:tutor"]);
  assert.deepEqual(h.deliveries, [{ heard: "蜗牛背着小房子。" }]);
  assert.ok(h.timings.includes("barge-in-confirmed"));

  // A dog's bark: nothing recognised, so the volume comes back and the interruption watch restarts.
  h = harness({ duck: true });
  start(h);
  const before = h.stops();
  h.watches[0].onBargeIn();
  h.listens[0].onEnd("");
  assert.deepEqual(h.ducks, [true, false]);
  assert.equal(h.stops(), before, "Xiaoyu was never stopped");
  assert.deepEqual(h.interrupted, []);
  assert.equal(h.watches.length, 2, "listening for an interruption again");
  assert.ok(h.timings.includes("barge-in-dismissed"));

  // Speech that cannot be made quieter (not on the page's output) stops at once, as before.
  h = harness({ duck: false });
  start(h);
  const earlier = h.stops();
  h.watches[0].onBargeIn();
  assert.ok(h.stops() > earlier);
  assert.deepEqual(h.interrupted, ["turn-2:tutor"]);
});

test("during a voice interruption, Xiaoyu's own echo or a short backchannel lets her carry on; real words stop her", () => {
  const start = (h) => {
    const reply = h.session.playStreamingReply();
    reply.push("蜗牛背着小房子。"); reply.push("它爬过的地方亮晶晶的。");
    h.sinks[0].callbacks.onStart();
    reply.attach("turn-3:tutor");
    h.watches[0].onBargeIn();
  };
  for (const [said, stage] of [["它爬过的地方亮晶晶", "barge-in-echo"], ["嗯嗯", "barge-in-backchannel"]]) {
    const h = harness({ duck: true });
    start(h);
    assert.equal(h.listens[0].speakingText, "蜗牛背着小房子。它爬过的地方亮晶晶的。", "the check knows what Xiaoyu is saying");
    const before = h.stops();
    h.listens[0].onEnd(said);
    assert.equal(h.stops(), before, `${said}: Xiaoyu was not stopped`);
    assert.deepEqual(h.ducks, [true, false], "her volume comes back");
    assert.deepEqual(h.inputs, [], "nothing is sent as the child's words");
    assert.deepEqual(h.interrupted, []);
    assert.ok(h.timings.includes(stage));
    assert.equal(h.watches.length, 2, "listening for an interruption again");
  }
  const h = harness({ duck: true });
  start(h);
  h.listens[0].onEnd("我想看蚂蚁搬家");
  assert.deepEqual(h.interrupted, ["turn-3:tutor"], "real words stop her");
  assert.deepEqual(h.inputs, ["我想看蚂蚁搬家"]);
});

test("a possible interruption that nobody follows with talking lets Xiaoyu carry on after a short wait", () => {
  const h = harness({ duck: true });
  const reply = h.session.playStreamingReply();
  reply.push("蜗牛背着小房子。"); reply.push("它爬过的地方亮晶晶的。");
  h.sinks[0].callbacks.onStart();
  h.watches[0].onBargeIn();
  assert.equal(h.listens[0].noSpeechTimeoutMs, 1500, "only a short wait for someone to start talking");
  const before = h.stops();
  h.listens[0].onIdle();
  assert.equal(h.stops(), before, "she was never stopped");
  assert.deepEqual(h.ducks, [true, false], "her volume comes back");
  assert.ok(h.timings.includes("barge-in-empty"), "counted as a false trigger");
  assert.equal(h.timings.includes("capture-idle"), false, "not counted as missing the child");
  assert.equal(h.watches.length, 2, "listening for an interruption again");
});
