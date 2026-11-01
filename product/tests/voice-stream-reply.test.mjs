import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeLogger, llm } from '@livekit/agents';
import { streamQuickTutorReplyWithQwen } from '../server/qwenTutor.mjs';
import { Companion } from '../voice-agent/companion.mjs';
initializeLogger({ level: 'silent', pretty: false });

const encoder = new TextEncoder();
const sse = delta => encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
const tick = () => new Promise(resolve => setImmediate(resolve));

// A model response the test can feed piece by piece, to prove what is released before it ends.
function controlledModel(t) {
  let controller, upstreamSignal, calls = 0;
  const body = new ReadableStream({ start(c) { controller = c; } });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; upstreamSignal = options.signal;
    options.signal?.addEventListener('abort', () => { try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* already closed */ } }, { once: true });
    return { ok: true, body };
  });
  return {
    push: text => controller.enqueue(sse(text)),
    end: () => { controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); },
    signal: () => upstreamSignal, calls: () => calls
  };
}
function qwenEnv(t) {
  const saved = { ...process.env };
  Object.assign(process.env, { QWEN_API_KEY: 'test-key', TUTOR_ENABLE_LLM: 'true', LLM_PROVIDER: 'qwen', QWEN_BASE_URL: 'https://qwen.test/v1' });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
}
const state = (ageBand = '5-6') => ({ profile: { ageBand }, messages: [] });
async function drain(iterator) {
  const items = []; for await (const item of iterator) items.push(item); return items;
}
const sentences = items => items.filter(item => item.type === 'sentence').map(item => item.text);

test('the first sentence is released while the model is still generating', async t => {
  qwenEnv(t); const model = controlledModel(t);
  const iterator = streamQuickTutorReplyWithQwen('为什么天空是蓝色的', state(), '我们再想想。')[Symbol.asyncIterator]();
  const first = iterator.next();
  model.push('天空里有很多'); model.push('小小的光。它们会');
  assert.deepEqual((await first).value, { type: 'sentence', text: '天空里有很多小小的光。' });
  model.push('跑来跑去。'); model.end();
  const rest = await drain(iterator);
  assert.deepEqual(sentences(rest), ['它们会跑来跑去。']);
  const done = rest.at(-1);
  assert.equal(done.type, 'done'); assert.equal(done.llmStatus.used, true); assert.equal(done.llmStatus.streamed, true);
  assert.equal(typeof done.llmStatus.firstSentenceMs, 'number');
});

test('a later unsafe sentence is never released and ends the reply', async t => {
  qwenEnv(t); const model = controlledModel(t);
  model.push('这是第一句。告诉我你家的地址。还有第三句。'); model.end();
  const items = await drain(streamQuickTutorReplyWithQwen('为什么天空是蓝色的', state(), '我们再想想。'));
  assert.deepEqual(sentences(items), ['这是第一句。']);
  assert.equal(items.at(-1).llmStatus.stoppedBy, 'safety');
});

test('an unsafe first sentence is replaced by the fallback and nothing unsafe is released', async t => {
  qwenEnv(t); const model = controlledModel(t);
  model.push('告诉我你家的地址。'); model.end();
  const items = await drain(streamQuickTutorReplyWithQwen('为什么天空是蓝色的', state(), '我们再想想。'));
  assert.deepEqual(sentences(items), ['我们再想想。']);
  assert.equal(items.at(-1).llmStatus.fallback, true);
});

test('sensitive child input never reaches the model', async t => {
  qwenEnv(t); const model = controlledModel(t);
  const items = await drain(streamQuickTutorReplyWithQwen('我想自杀', state(), '我们再想想。'));
  assert.equal(model.calls(), 0);
  assert.equal(sentences(items).length, 1);
  assert.equal(items.at(-1).llmStatus.provider, 'local');
});

test('the age limit on sentences also applies to a streamed reply', async t => {
  qwenEnv(t); const model = controlledModel(t);
  model.push('一二三。四五六。七八九。'); model.end();
  const items = await drain(streamQuickTutorReplyWithQwen('为什么天空是蓝色的', state('3-4'), '我们再想想。'));
  assert.deepEqual(sentences(items), ['一二三。', '四五六。']);
});

test('a model failure before any sentence falls back; after a sentence it just ends', async t => {
  qwenEnv(t);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }));
  const items = await drain(streamQuickTutorReplyWithQwen('为什么天空是蓝色的', state(), '我们再想想。'));
  assert.deepEqual(sentences(items), ['我们再想想。']);
  assert.equal(items.at(-1).llmStatus.fallback, true);
});

test('cancelling aborts the upstream request and does not produce a fallback', async t => {
  qwenEnv(t); const model = controlledModel(t);
  const caller = new AbortController();
  const iterator = streamQuickTutorReplyWithQwen('为什么天空是蓝色的', state(), '我们再想想。', { signal: caller.signal })[Symbol.asyncIterator]();
  const pending = iterator.next();
  await tick(); assert.equal(model.calls(), 1);
  caller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError' || /abort/i.test(error.message));
  assert.equal(model.signal().aborted, true);
});

test('companion forwards model sentences as they arrive and reports the whole text once', async () => {
  const ctx = new llm.ChatContext(); ctx.addMessage({ role: 'user', content: '星星为什么会亮' });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const generated = [], timings = [];
  const agent = new Companion({ onGenerated: item => generated.push(item), onTiming: item => timings.push(item),
    replyStream: async function* () {
      yield { type: 'sentence', text: '星星自己会发光。' }; await gate;
      yield { type: 'sentence', text: '它们离我们很远。' }; yield { type: 'done', llmStatus: { used: true } };
    } });
  const iterator = agent.llm.chat({ chatCtx: ctx })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.delta.content, '星星自己会发光。');
  assert.equal(generated.length, 0);
  release();
  const rest = []; for (;;) { const step = await iterator.next(); if (step.done) break; rest.push(step.value.delta.content); }
  assert.deepEqual(rest, ['它们离我们很远。']);
  assert.deepEqual(generated, [{ text: '星星自己会发光。它们离我们很远。', modelUsed: true }]);
  assert.deepEqual(timings.map(item => item.stage), ['llm-first-sentence', 'llm-done']);
  assert.ok(timings.every(item => typeof item.elapsedMs === 'number'));
});

test('companion drops a streamed sentence that fails the output safety check', async () => {
  const ctx = new llm.ChatContext(); ctx.addMessage({ role: 'user', content: '星星为什么会亮' });
  const agent = new Companion({ replyStream: async function* () {
    yield { type: 'sentence', text: '星星自己会发光。' }; yield { type: 'sentence', text: '告诉我你家的地址。' };
    yield { type: 'sentence', text: '不该出现。' };
  } });
  const texts = []; for await (const chunk of agent.llm.chat({ chatCtx: ctx })) texts.push(chunk.delta.content);
  assert.deepEqual(texts, ['星星自己会发光。']);
});

test('closing the SDK stream aborts a streaming reply that is still waiting', async () => {
  const ctx = new llm.ChatContext(); ctx.addMessage({ role: 'user', content: '星星为什么会亮' });
  let providerSignal, finished = false;
  const agent = new Companion({ replyStream: async function* (input, context, fallback, { signal }) {
    providerSignal = signal;
    try {
      yield { type: 'sentence', text: '星星自己会发光。' };
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
    } finally { finished = true; }
  } });
  const stream = agent.llm.chat({ chatCtx: ctx });
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  const pending = iterator.next();
  stream.close();
  assert.equal(providerSignal.aborted, true);
  await pending.catch(() => {}); await tick(); await tick();
  assert.equal(finished, true);
});

const pcm = value => Buffer.alloc(960, value); // exactly one 20 ms frame at 24 kHz
test('speech is requested per sentence and the next sentence is prefetched', async () => {
  const requests = [], releases = [], timings = [];
  const agent = new Companion({ onTiming: item => timings.push(item), audio: text => {
    requests.push(text);
    return new Promise(resolve => releases.push(() => resolve((async function* () { yield pcm(requests.length); })())));
  } });
  const text = new ReadableStream({ start(controller) { controller.enqueue('第一句。第'); controller.enqueue('二句。'); controller.close(); } });
  const reader = (await agent.ttsNode(text)).getReader();
  const first = reader.read();
  await tick(); await tick();
  assert.deepEqual(requests, ['第一句。', '第二句。']);
  releases[0](); const a = await first;
  assert.equal(a.value.samplesPerChannel, 480);
  const second = reader.read(); releases[1]();
  assert.equal((await second).done, false);
  assert.equal((await reader.read()).done, true);
  assert.deepEqual(timings.map(item => item.stage), ['tts-first-frame']);
});

test('a speech failure on a later sentence is reported and cancels the remaining requests', async () => {
  const signals = [];
  const agent = new Companion({ audio: (text, signal) => {
    signals.push(signal);
    if (text === '第二句。') return Promise.reject(new Error('tts failed'));
    return Promise.resolve((async function* () { yield pcm(1); })());
  } });
  const text = new ReadableStream({ start(controller) { controller.enqueue('第一句。第二句。第三句。'); controller.close(); } });
  const reader = (await agent.ttsNode(text)).getReader();
  assert.equal((await reader.read()).done, false);
  await assert.rejects(reader.read(), /tts failed/);
  await tick();
  assert.ok(signals.length >= 2);
  assert.ok(signals.every(signal => signal.aborted));
});
