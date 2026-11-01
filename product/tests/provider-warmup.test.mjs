import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderWarmup } from '../server/providerWarmup.mjs';

const env = { QWEN_BASE_URL: 'https://dashscope.example.com/compatible-mode/v1/', QWEN_API_KEY: 'test-key' };

test('warm-up sends concurrent authenticated model-list requests and drains each body', async () => {
  const calls = [];
  let drained = 0, active = 0, peak = 0;
  const warm = createProviderWarmup({ env, fetchImpl: async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization });
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { ok: true, arrayBuffer: async () => { drained++; return new ArrayBuffer(0); } };
  } });
  assert.equal(await warm(), true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url === 'https://dashscope.example.com/compatible-mode/v1/models' && call.auth === 'Bearer test-key'));
  assert.equal(peak, 2, 'sequential requests would reuse one socket instead of warming two');
  assert.equal(drained, 2, 'an undrained body keeps the socket out of the pool');
});

test('concurrent warm-ups share one batch; a later one sends again', async () => {
  let count = 0;
  const releases = [];
  const warm = createProviderWarmup({ env, sockets: 1, fetchImpl: async () => {
    count++;
    await new Promise(resolve => { releases.push(resolve); });
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  } });
  const first = warm(), second = warm();
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  releases.shift()(); await first;
  const third = warm();
  await new Promise(resolve => setImmediate(resolve));
  releases.shift()(); await third;
  assert.equal(count, 2);
});

test('warm-up never throws and is skipped when disabled or unconfigured', async () => {
  let count = 0;
  const failing = createProviderWarmup({ env, sockets: 1, fetchImpl: async () => { count++; throw new Error('offline'); } });
  assert.equal(await failing(), false);
  for (const flag of ['PROVIDER_WARM_CONNECTIONS', 'VOICE_LAB_WARM_CONNECTIONS']) {
    assert.equal(await createProviderWarmup({ env: { ...env, [flag]: 'false' }, fetchImpl: async () => { count++; } })(), false);
  }
  assert.equal(await createProviderWarmup({ env: {}, fetchImpl: async () => { count++; } })(), false);
  assert.equal(count, 1);
});

