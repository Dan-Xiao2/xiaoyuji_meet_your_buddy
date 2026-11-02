import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotLog, summarizePilot, describeDevice } from '../src/services/pilotLog.js';

const memoryStorage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data }; };

test('only allow-listed fields are stored; text, names and arbitrary fields never are', () => {
  const storage = memoryStorage();
  const log = createPilotLog({ storage, now: () => 1000 });
  log.record({ stage: 'endpoint', latencyMs: 1050.4, text: '天空为什么是蓝色的', childName: '小明', audio: 'AAAA' });
  log.record({ stage: 'asr-realtime-fallback', latencyMs: 0, reason: 'disconnected' });
  log.record({ stage: 'asr-realtime-fallback', latencyMs: 0, reason: '孩子说了什么' });
  log.record({ stage: 'Bad Stage!', latencyMs: 1 });
  log.record({ stage: 'quick-reply', latencyMs: 'not-a-number' });
  const raw = [...storage.data.values()].join('');
  for (const forbidden of ['天空', '小明', 'AAAA', '孩子说了什么']) assert.equal(raw.includes(forbidden), false);
  assert.deepEqual(log.entries().map(entry => [entry.stage, entry.reason]), [['endpoint', undefined], ['asr-realtime-fallback', 'disconnected'], ['asr-realtime-fallback', undefined]]);
});

test('turns advance at each end-point, survive a reload through storage, and clear resets them', () => {
  const storage = memoryStorage();
  const first = createPilotLog({ storage });
  first.record({ stage: 'endpoint', latencyMs: 1000 }); first.record({ stage: 'quick-reply', latencyMs: 900 });
  first.record({ stage: 'endpoint', latencyMs: 1100 });
  const reloaded = createPilotLog({ storage });
  reloaded.record({ stage: 'endpoint', latencyMs: 1200 });
  assert.deepEqual(reloaded.entries().map(entry => entry.turn), [1, 1, 2, 3]);
  reloaded.clear();
  assert.equal(createPilotLog({ storage }).entries().length, 0);
});

test('recognition connecting while the child starts speaking belongs to the new turn, not the previous one', () => {
  const log = createPilotLog();
  // Order observed on a real iPhone: connect is reported before the end-point of the same utterance.
  for (const stage of ['endpoint', 'asr-realtime-connect', 'asr-realtime-final', 'tts-first-audio', 'response-start',
    'asr-realtime-connect', 'endpoint', 'asr-realtime-final', 'quick-reply', 'response-start']) log.record({ stage, latencyMs: 1 });
  assert.deepEqual(log.entries().map(entry => entry.turn), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  const streamed = createPilotLog();
  for (const stage of ['endpoint', 'asr-realtime-final', 'tts-first-audio', 'response-start', 'quick-reply', 'asr-realtime-connect', 'endpoint']) streamed.record({ stage, latencyMs: 1 });
  assert.deepEqual(streamed.entries().map(entry => entry.turn), [1, 1, 1, 1, 1, 2, 2], 'a whole-reply time after speech started stays in its turn');
  const watched = createPilotLog();
  watched.record({ stage: 'response-start', latencyMs: 1 });
  watched.record({ stage: 'barge-in-watch', latencyMs: 4000, reason: 'stopped', levels: { micPeak: 0.0412, outPeak: 0.2, coupling: 0.6, thresholdMin: 0.012, bestMargin: 0.83, echoCancellation: 0, text: 'x', audio: [1] } });
  assert.deepEqual(watched.entries().map(entry => entry.turn), [1, 1], 'the barge-in summary stays in its turn');
  assert.deepEqual(watched.entries()[1].levels, { micPeak: 0.041, outPeak: 0.2, coupling: 0.6, thresholdMin: 0.012, bestMargin: 0.83, echoCancellation: 0 }, 'only the fixed numeric levels are kept');
  const silent = createPilotLog();
  for (const stage of ['endpoint', 'quick-reply', 'endpoint', 'quick-reply']) silent.record({ stage, latencyMs: 1 });
  assert.deepEqual(silent.entries().map(entry => entry.turn), [1, 1, 2, 2], 'without playback, a second end-point opens a turn');
});

test('summary gives per-stage percentiles and failure counts; export uses relative times and a coarse device', () => {
  let clock = 5000;
  const log = createPilotLog({ now: () => clock });
  for (const ms of [100, 200, 300, 400, 1000]) {
    log.record({ stage: 'endpoint', latencyMs: 50 });
    // A speech fallback happens before playback starts, within the same turn.
    if (ms === 1000) log.record({ stage: 'tts-stream-fallback', latencyMs: 0 });
    log.record({ stage: 'response-start', latencyMs: ms }); clock += 10;
  }
  const summary = summarizePilot(log.entries());
  assert.deepEqual(summary.stages['response-start'], { count: 5, p50: 300, p90: 1000, max: 1000 });
  assert.equal(summary.turns, 5);
  assert.deepEqual(summary.failures, { 'tts-stream-fallback': 1 });
  const file = log.exportFile({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Version/18.2 Mobile/15E148 Safari/604.1', viewport: { width: 390.4, height: 844 } });
  assert.deepEqual(file.device, { platform: 'iOS 18.2', browser: 'Safari', viewport: { width: 390, height: 844 } });
  assert.equal(file.entries[0].atMs, 0);
  assert.equal('at' in file.entries[0], false);
  assert.equal(JSON.stringify(file).includes('Mozilla'), false, 'the raw user agent is not exported');
});

test('blocked storage falls back to memory without throwing', () => {
  const log = createPilotLog({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } } });
  log.record({ stage: 'endpoint', latencyMs: 1 });
  assert.equal(log.entries().length, 1);
  log.clear();
  assert.equal(describeDevice('', {}).platform, 'other');
});
