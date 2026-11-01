import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeLogger, llm } from '@livekit/agents';
import { TokenVerifier } from 'livekit-server-sdk';
import { providerStream, pcmFrames } from '../voice-agent/streams.mjs';
import { Companion } from '../voice-agent/companion.mjs';
import { createVoiceLab } from '../server/voiceLab.mjs';
initializeLogger({ level: 'silent', pretty: false });

test('cancelled LLM stream aborts a provider request before it resolves and drops late output', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  let providerSignal;
  const stream = providerStream(async (emit, signal) => {
    providerSignal = signal; entered();
    await new Promise(resolve => { release = resolve; });
    emit('late');
  });
  const reader = stream.getReader();
  const pending = reader.read(); await started;
  await reader.cancel(); assert.equal(providerSignal.aborted, true);
  release(); assert.equal((await pending).done, true);
});

test('PCM framing preserves samples across arbitrary network chunk boundaries', async () => {
  const bytes = Buffer.alloc(962); for (let i = 0; i < 481; i++) bytes.writeInt16LE(i - 240, i * 2);
  async function* chunks() { yield bytes.subarray(0, 1); yield bytes.subarray(1, 117); yield bytes.subarray(117); }
  const frames = []; for await (const frame of pcmFrames(chunks())) frames.push(frame);
  assert.deepEqual(frames.map(frame => frame.samplesPerChannel), [480, 1]);
  assert.deepEqual([...frames[0].data, ...frames[1].data], Array.from({ length: 481 }, (_, i) => i - 240));
});

test('truncated PCM cannot silently become playable audio', async () => {
  async function* chunks() { yield Buffer.from([1]); }
  await assert.rejects(async () => { for await (const frame of pcmFrames(chunks())) void frame; }, /Incomplete PCM/);
});

test('interrupted assistant estimate is omitted from the next model context', async () => {
  const ctx = new llm.ChatContext();
  ctx.addMessage({ role: 'user', content: '我喜欢星星' });
  ctx.addMessage({ role: 'assistant', content: '这段话没有确认听完', interrupted: true });
  ctx.addMessage({ role: 'user', content: '星星为什么会亮' });
  let received;
  const agent = new Companion({ reply: async (input, context) => { received = context; return { reply: '星星自己会发光。' }; } });
  const stream = agent.llm.chat({ chatCtx: ctx });
  const result = []; for await (const text of stream) result.push(typeof text === 'string' ? text : text.delta.content);
  assert.deepEqual(result, ['星星自己会发光。']);
  assert.equal(received.messages.some(item => item.text.includes('没有确认听完')), false);
  assert.equal(received.messages[0].text, '我喜欢星星');
});

test('drawing experiment does not announce an unexecuted picture', async () => {
  const ctx = new llm.ChatContext(); ctx.addMessage({ role: 'user', content: '画三个苹果' });
  const agent = new Companion({ reply: () => { throw new Error('Should use the capability boundary'); } });
  const texts = []; for await (const text of agent.llm.chat({ chatCtx: ctx })) texts.push(typeof text === 'string' ? text : text.delta.content);
  assert.match(texts.join(''), /还不能画画/);
});

test('sensitive input bypasses the model', async () => {
  const ctx = new llm.ChatContext(); ctx.addMessage({ role: 'user', content: '我想自杀' });
  let calls = 0;
  const agent = new Companion({ reply: () => { calls++; throw new Error('must not call'); } });
  const texts = []; for await (const text of agent.llm.chat({ chatCtx: ctx })) texts.push(typeof text === 'string' ? text : text.delta.content);
  assert.equal(calls, 0); assert.ok(texts.join('').length);
});

function labSetup() {
  const calls = [];
  const config = () => ({ enabled: true, provider: 'synthetic', url: 'ws://127.0.0.1:7880', apiKey: 'testkey', apiSecret: 'test-secret-at-least-32-characters-long' });
  const lab = createVoiceLab({ config, clients: () => ({ rooms: {
    createRoom: async options => calls.push(['create', options]),
    deleteRoom: async name => calls.push(['delete', name])
  }, dispatch: { createDispatch: async (...args) => calls.push(['dispatch', ...args]) } }) });
  return { lab, calls, config };
}

test('lab requires explicit consent and limits an active session to its own room grant', async () => {
  const { lab, calls, config } = labSetup();
  assert.equal((await lab.start({ ageBand: '4-5' })).status, 400);
  assert.equal(calls.length, 0);
  const session = (await lab.start({ ageBand: '4-5', consent: true })).data;
  const claims = await new TokenVerifier(config().apiKey, config().apiSecret).verify(session.token);
  assert.equal(claims.video.room, session.sessionId);
  assert.deepEqual(claims.video.canPublishSources, ['microphone']);
  assert.equal(claims.video.roomAdmin, undefined);
  assert.equal((await lab.start({ ageBand: '4-5', consent: true })).status, 429);
  assert.equal((await lab.stop({ sessionId: session.sessionId, stopToken: 'wrong' })).status, 403);
  assert.equal((await lab.stop(session)).status, 200);
  assert.equal((await lab.stop(session)).status, 200);
});

test('lab disabled by default cannot mint a room token', async () => {
  const lab = createVoiceLab({ config: () => ({ enabled: false }) });
  assert.equal((await lab.start({ consent: true, ageBand: '4-5' })).status, 503);
});

test('Qwen adapter reuses one continuous connection and sends PCM before final transcripts', async () => {
  const { EventEmitter } = await import('node:events');
  const { AudioFrame } = await import('@livekit/rtc-node');
  const { QwenSTT } = await import('../voice-agent/qwenStt.mjs');
  const sent = []; let connections = 0, closed = false;
  class Socket extends EventEmitter {
    bufferedAmount = 0;
    send(raw) {
      const message = JSON.parse(raw); sent.push(message);
      if (message.type === 'session.update') queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'session.updated' })));
      if (message.type === 'input_audio_buffer.append') queueMicrotask(() => {
        for (const event of [{ type: 'input_audio_buffer.speech_started' },
          { type: 'conversation.item.input_audio_transcription.completed', transcript: '模拟识别' }]) this.emit('message', JSON.stringify(event));
      });
    }
    terminate() { closed = true; this.emit('close'); }
  }
  const provider = new QwenSTT({ config: { enabled: true, endpoint: 'wss://test.invalid', key: 'synthetic', language: 'zh' },
    connect: () => { connections++; const socket = new Socket(); queueMicrotask(() => socket.emit('open')); return socket; } });
  const stream = provider.stream({ connOptions: { maxRetry: 0 } });
  for (let turn = 0; turn < 2; turn++) {
    stream.pushFrame(new AudioFrame(new Int16Array(320).fill(10), 16000, 1, 320));
    const events = []; for (let i = 0; i < 3; i++) events.push((await stream.next()).value);
    assert.equal(events[1].alternatives[0].text, '模拟识别');
  }
  stream.close(); await provider.close();
  assert.equal(closed, true); assert.equal(connections, 1);
  assert.equal(sent[0].session.turn_detection.type, 'server_vad');
  assert.equal(sent.filter(event => event.type === 'input_audio_buffer.append').length, 2);
  assert.equal(sent.some(event => event.type === 'session.finish'), false);
});

test('SDK LLM close aborts the business request while it is still waiting', async () => {
  const ctx = new llm.ChatContext(); ctx.addMessage({ role: 'user', content: '为什么天空是蓝色的' });
  let entered, providerSignal;
  const started = new Promise(resolve => { entered = resolve; });
  const agent = new Companion({ reply: (input, context, fallback, { signal }) => {
    providerSignal = signal; entered();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  } });
  const stream = agent.llm.chat({ chatCtx: ctx });
  await started; stream.close(); assert.equal(providerSignal.aborted, true);
});

async function clientFixture(t) {
  const { EventEmitter } = await import('node:events');
  const { RoomEvent, ParticipantKind } = await import('livekit-client');
  const { createLivekitVoiceClient } = await import('../src/services/livekitVoiceClient.js');
  const room = new EventEmitter(), states = [], controls = [];
  room.startAudio = room.connect = room.disconnect = async () => {};
  room.localParticipant = { setMicrophoneEnabled: async () => {}, publishData: async bytes => controls.push(JSON.parse(new TextDecoder().decode(bytes))) };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ sessionId: 'session-test', token: 'test', url: 'ws://test.invalid' }) }));
  const client = createLivekitVoiceClient({ createRoom: () => room, audioContainer: { querySelectorAll: () => [] }, onState: state => states.push(state) });
  t.after(() => client.stop());
  let sequence = 0;
  const event = data => room.emit(RoomEvent.DataReceived, new TextEncoder().encode(JSON.stringify({ sessionId: 'session-test', seq: ++sequence, ...data })), { kind: ParticipantKind.AGENT }, 0, 'xiaoyu.voice-lab');
  await client.start({ ageBand: '4-5', consent: true });
  return { client, states, controls, event, room, RoomEvent };
}

test('client cannot display listening or send text before input-ready proof', async t => {
  const { client, states, controls, event } = await clientFixture(t);
  event({ type: 'state', state: 'listening' });
  assert.equal(states.at(-1), 'waiting-agent');
  event({ type: 'ready', state: 'listening' });
  assert.equal(states.at(-1), 'waiting-agent');
  await assert.rejects(client.sendText('早到的文字'), /not ready/);
  assert.equal(controls.some(item => item.type === 'text'), false);
  event({ type: 'ready', state: 'listening', inputReady: true });
  assert.equal(states.at(-1), 'listening');
  await client.sendText('准备好了');
  assert.equal(controls.at(-1).text, '准备好了');
});

test('cancelled or reconnecting client rejects stale readiness and state', async t => {
  const { client, states, event, room, RoomEvent } = await clientFixture(t);
  event({ type: 'ready', state: 'listening', inputReady: true });
  room.emit(RoomEvent.Reconnecting);
  event({ type: 'state', state: 'listening' });
  assert.equal(states.at(-1), 'reconnecting');
  await client.stop();
  event({ type: 'ready', state: 'listening', inputReady: true });
  event({ type: 'state', state: 'speaking' });
  assert.equal(states.at(-1), 'stopped');
});

async function delayedAsrFixture() {
  const { EventEmitter } = await import('node:events');
  const { QwenSTT } = await import('../voice-agent/qwenStt.mjs');
  const { AudioFrame } = await import('@livekit/rtc-node');
  const sent = [], diagnostics = []; let socket, readyCalls = 0, connected;
  const connection = new Promise(resolve => { connected = resolve; });
  class Socket extends EventEmitter {
    bufferedAmount = 0;
    send(raw) { sent.push(JSON.parse(raw)); }
    terminate() { this.emit('close'); }
  }
  const provider = new QwenSTT({ config: { enabled: true, endpoint: 'wss://test.invalid', key: 'synthetic', language: 'zh' },
    onInputReady: () => { readyCalls++; }, onDiagnostics: event => diagnostics.push(event),
    connect: () => { socket = new Socket(); queueMicrotask(() => { socket.emit('open'); connected(); }); return socket; } });
  const stream = provider.stream({ connOptions: { maxRetry: 0 } });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  await connection;
  return { stream, sent, diagnostics, tick, readyCalls: () => readyCalls,
    frame: value => new AudioFrame(Int16Array.from([value, value + 1, value + 2]), 16000, 1, 3),
    acknowledge: () => socket.emit('message', JSON.stringify({ type: 'session.updated' })),
    close: async () => { stream.close(); await provider.close(); await tick(); } };
}

test('delayed ASR handshake preserves first samples exactly once and signals ready after append', async () => {
  const f = await delayedAsrFixture();
  try {
    f.stream.pushFrame(f.frame(101)); f.stream.pushFrame(f.frame(201));
    await f.tick();
    assert.equal(f.readyCalls(), 0);
    assert.equal(f.sent.filter(item => item.type === 'input_audio_buffer.append').length, 0);
    f.acknowledge(); await f.tick();
    assert.equal(f.readyCalls(), 1);
    const samples = f.sent.filter(item => item.type === 'input_audio_buffer.append').flatMap(item => {
      const bytes = Buffer.from(item.audio, 'base64'); return [0, 2, 4].map(index => bytes.readInt16LE(index));
    });
    assert.deepEqual(samples, [101, 102, 103, 201, 202, 203]);
    const input = f.diagnostics.find(item => item.stage === 'asr-first-frame');
    const append = f.diagnostics.find(item => item.stage === 'asr-first-append');
    assert.equal(input.receivedSamples, 3); assert.equal(append.sentSamples, 3);
    assert.ok(input.elapsedMs <= append.elapsedMs);
  } finally { await f.close(); }
});

test('ASR acknowledgement alone is not input readiness; cancel drops queued first frames', async () => {
  const f = await delayedAsrFixture();
  f.acknowledge(); await f.tick(); assert.equal(f.readyCalls(), 0);
  await f.close();
  const pending = await delayedAsrFixture();
  pending.stream.pushFrame(pending.frame(500)); await pending.close();
  pending.acknowledge(); await pending.tick();
  assert.equal(pending.readyCalls(), 0);
  assert.equal(pending.sent.filter(item => item.type === 'input_audio_buffer.append').length, 0);
});
