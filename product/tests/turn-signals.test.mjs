import test from "node:test";
import assert from "node:assert/strict";
import { endpointHint, isBackchannel, isEcho } from "../src/features/voice/turnSignals.js";

const reply = "蜗牛背着自己的房子慢慢爬，下雨的时候最喜欢出来散步。";

test("Xiaoyu's own words coming back are echo, even with dropped or swapped characters", () => {
  for (const heard of ["蜗牛背着自己的房子", "蜗牛背的自己房子", "下雨的时候最喜欢"]) assert.equal(isEcho(heard, reply), true, heard);
});

test("a child's own sentence that shares common characters with the reply is not echo", () => {
  for (const heard of ["我也喜欢下雨", "小宇我想看蚂蚁", "是的", ""]) assert.equal(isEcho(heard, reply), false, heard);
  assert.equal(isEcho("蜗牛背着自己的房子", ""), false, "nothing to compare with");
});

test("short acknowledgements are backchannels; anything with content is not", () => {
  for (const said of ["嗯", "嗯嗯。", "对对对", "好的", "然后呢？", "哦"]) assert.equal(isBackchannel(said), true, said);
  for (const said of ["嗯我也想去", "不对", "我不要", ""]) assert.equal(isBackchannel(said), false, said);
});

test("questions sound finished, hanging sentences unfinished, and plain statements keep the usual wait", () => {
  assert.equal(endpointHint("月亮为什么跟着我走呢？"), "complete");
  assert.equal(endpointHint("这是什么吗"), "complete");
  assert.equal(endpointHint("我看到一只蜗牛然后"), "unfinished");
  assert.equal(endpointHint("我看到一只蜗牛，"), "unfinished");
  assert.equal(endpointHint("我看到一只蜗牛。"), null);
  assert.equal(endpointHint("嗯"), null, "too short to judge");
});

test("the silence that ends speech follows the hint: shorter after a question, longer mid-thought", async () => {
  const { createVoiceActivityDetector } = await import("../src/services/voiceActivity.js");
  const run = silenceMs => {
    const detector = createVoiceActivityDetector();
    if (silenceMs !== undefined) detector.setSilenceMs(silenceMs);
    let now = 0;
    for (let i = 0; i < 20; i++) detector.update(0.05, now += 50); // a second of speech
    for (let i = 0; i < 100; i++) { const event = detector.update(0, now += 50); if (event.completed) return event.silenceMs; }
    return "never stopped";
  };
  assert.equal(run(), 1050, "usual wait");
  assert.equal(run(550), 550, "a clear question");
  assert.equal(run(1800), 1800, "mid-thought");
  assert.equal(run(null), 1050, "no hint returns to the usual wait");
});
