import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderWarmup } from '../server/providerWarmup.mjs';

const env = { QWEN_BASE_URL: 'https://dashscope.example.com/compatible-mode/v1/', QWEN_API_KEY: 'test-key' };

test('warm-up requests the model list on the provider host with auth and drains the body', async () => {
  const calls = [];
  let drained = false;
  const warm = createProviderWarmup({ env, fetchImpl: async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization });
    return { ok: true, arrayBuffer: async () => { drained = true; return new ArrayBuffer(0); } };
  } });
  assert.equal(await warm(), true);
  assert.deepEqual(calls, [{ url: 'https://dashscope.example.com/compatible-mode/v1/models', auth: 'Bearer test-key' }]);
  assert.ok(drained, 'an undrained body keeps the socket out of the pool');
});

test('concurrent warm-ups share one request; a later one sends again', async () => {
  let count = 0, release;
  const warm = createProviderWarmup({ env, fetchImpl: async () => {
    count++;
    await new Promise(resolve => { release = resolve; });
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  } });
  const first = warm(), second = warm();
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  release(); await first;
  const third = warm();
  await new Promise(resolve => setImmediate(resolve));
  release(); await third;
  assert.equal(count, 2);
});

test('warm-up never throws and is skipped when disabled or unconfigured', async () => {
  let count = 0;
  const failing = createProviderWarmup({ env, fetchImpl: async () => { count++; throw new Error('offline'); } });
  assert.equal(await failing(), false);
  assert.equal(await createProviderWarmup({ env: { ...env, VOICE_LAB_WARM_CONNECTIONS: 'false' }, fetchImpl: async () => { count++; } })(), false);
  assert.equal(await createProviderWarmup({ env: {}, fetchImpl: async () => { count++; } })(), false);
  assert.equal(count, 1);
});
