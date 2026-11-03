import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';

// This file has its own test process. Never contact model providers in boundary tests.
Object.assign(process.env, { LAN_ACCESS_CODE: 'test-only-2345', HTTPS_CERT: '', HTTPS_KEY: '',
  ASR_REALTIME: 'false', TUTOR_ENABLE_LLM: 'false', USE_CLOUD_TTS: 'false', IMAGE_DRAWING_ENABLED: 'false' });
const { server } = await import('../server/server.mjs');
let origin, cookie;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + '/pair', {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'code=test-only-2345'
  });
  assert.equal(response.status, 303);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  // Manually attach only in this HTTP fixture; this does not prove HTTPS browser behavior.
  cookie = response.headers.get('set-cookie').split(';')[0];
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

test('paired mode protects local HTTP assets and APIs, including forwarded requests', async () => {
  for (const headers of [{}, { Cookie: 'xiaoyu_lan=forged' },
    { Forwarded: 'for=127.0.0.1;proto=https', 'X-Forwarded-For': '127.0.0.1' }]) {
    const page = await fetch(origin + '/', { headers, redirect: 'manual' });
    assert.equal(page.status, 303);
    assert.equal(page.headers.get('location'), '/pair');
    for (const path of ['/api/voice-status', '/api/tutor/quick/stream']) {
      const response = await fetch(origin + path, {
        method: path.includes('tutor') ? 'POST' : 'GET', headers: { Origin: origin, ...headers }
      });
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).reason, 'pairing-required');
    }
  }
  assert.equal((await fetch(origin + '/pair')).status, 200);
  assert.equal((await fetch(origin + '/', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(origin + '/api/voice-status', { headers: { Cookie: cookie } })).status, 200);
});

test('pairing and paired API calls still require same origin', async () => {
  for (const path of ['/pair', '/api/tutor/quick/stream']) {
    const response = await fetch(origin + path, {
      method: 'POST', headers: { Origin: 'https://example.invalid', Cookie: cookie }, body: '{}'
    });
    assert.equal(response.status, 403);
  }
});

test('paired mode refuses lab status, start and stop even for an authorized local client', async () => {
  for (const [path, method] of [['status', 'GET'], ['start', 'POST'], ['stop', 'POST']]) {
    const response = await fetch(origin + '/api/voice-lab/' + path, {
      method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {})
    });
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).reason, 'local-lab-only');
  }
});

function handshake(headers = {}, requestOrigin = origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace('http', 'ws') + '/api/asr/realtime', {
      origin: requestOrigin, headers, handshakeTimeout: 2000
    });
    ws.on('error', reject);
    ws.on('unexpected-response', (_request, response) => {
      response.resume();
      resolve({ status: response.statusCode });
    });
    ws.on('message', raw => {
      const result = { status: 101, message: JSON.parse(raw) };
      ws.once('close', () => resolve(result));
      ws.close();
    });
  });
}

test('real server WebSocket wiring requires the paired cookie and same origin', { timeout: 5000 }, async () => {
  for (const headers of [{}, { Cookie: 'xiaoyu_lan=forged' }, { 'X-Forwarded-For': '127.0.0.1' }]) {
    assert.equal((await handshake(headers)).status, 403);
  }
  assert.equal((await handshake({ Cookie: cookie }, 'https://example.invalid')).status, 403);
  assert.deepEqual(await handshake({ Cookie: cookie }), { status: 101, message: { type: 'error', code: 'disabled' } });
});
