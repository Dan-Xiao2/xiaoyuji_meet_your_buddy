import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createAccess, parseAccessCodes } from '../server/lanAccess.mjs';
import { createUsageLimits, usageLimitsFromEnv } from '../server/usageLimits.mjs';

// This file has its own test process. Never contact model providers in boundary tests.
const SECRET = 'test-only-secret-0123456789abcdef0123';
Object.assign(process.env, { PUBLIC_MODE: 'true', TRUST_PROXY: 'true', ACCESS_CODES: 'F1:test-F1-2345,F2:test-F2-6789', SESSION_SECRET: SECRET,
  ACCESS_SESSION_HOURS: '720', USAGE_DAILY_REPLIES: '1', LAN_ACCESS_CODE: '', HTTPS_CERT: '', HTTPS_KEY: '',
  ASR_REALTIME: 'false', TUTOR_ENABLE_LLM: 'false', USE_CLOUD_TTS: 'false', IMAGE_DRAWING_ENABLED: 'false' });
const { server } = await import('../server/server.mjs');
let origin;
const request = cookie => ({ headers: cookie ? { cookie } : {} });
const sessionOf = result => result.cookie.split(';')[0];

before(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

async function pair(code, from) {
  return fetch(origin + '/pair', { method: 'POST', redirect: 'manual',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': from }, body: `code=${code}` });
}

test('each family has its own code; the cookie names the family, not the code, and survives a restart', () => {
  const codes = parseAccessCodes(' F1:AAAA2345 , F2:BBBB6789 ');
  assert.deepEqual(codes, { F1: 'AAAA2345', F2: 'BBBB6789' });
  let clock = 0;
  const access = createAccess({ codes, secret: SECRET, now: () => clock, sessionMs: 1000 });
  const paired = access.pair('BBBB6789');
  assert.equal(paired.family, 'F2');
  assert.equal(paired.cookie.includes('BBBB6789'), false);
  assert.equal(access.familyOf(request(sessionOf(paired))), 'F2');
  // A restart with the same secret keeps the session.
  const restarted = createAccess({ codes, secret: SECRET, now: () => clock, sessionMs: 1000 });
  assert.equal(restarted.familyOf(request(sessionOf(paired))), 'F2');
  // A changed or removed code ends that family's sessions only.
  const f1 = sessionOf(access.pair('AAAA2345'));
  const rotated = createAccess({ codes: { F1: 'AAAA2345', F2: 'CCCC2345' }, secret: SECRET, now: () => clock });
  assert.equal(rotated.familyOf(request(sessionOf(paired))), null);
  assert.equal(rotated.familyOf(request(f1)), 'F1');
  assert.equal(createAccess({ codes: { F1: 'AAAA2345' }, secret: SECRET }).familyOf(request(sessionOf(paired))), null);
  // Another secret, an edited cookie, or an expired one is refused.
  assert.equal(createAccess({ codes, secret: SECRET.replace('0', '1') }).familyOf(request(sessionOf(paired))), null);
  assert.equal(access.familyOf(request(sessionOf(paired).replace('F2.', 'F1.'))), null);
  clock = 1001;
  assert.equal(access.familyOf(request(sessionOf(paired))), null);
});

test('wrong codes lock only the source that sent them', () => {
  let clock = 0;
  const access = createAccess({ codes: { F1: 'AAAA2345' }, secret: SECRET, now: () => clock, maxFailures: 3, lockMs: 5000 });
  for (let i = 0; i < 3; i++) assert.equal(access.pair('WRONG123', '1.2.3.4').reason, 'wrong-code');
  assert.equal(access.pair('AAAA2345', '1.2.3.4').reason, 'locked');
  assert.equal(access.pair('AAAA2345', '5.6.7.8').ok, true, 'another family is not locked out');
  clock += 5000;
  assert.equal(access.pair('AAAA2345', '1.2.3.4').ok, true);
});

test('malformed code lists, shared or short codes and short secrets stop the server from starting', () => {
  for (const value of ['F1', 'F 1:AAAA2345', 'F1:AAAA2345,F1:BBBB6789']) assert.throws(() => parseAccessCodes(value), /ACCESS_CODES/);
  assert.throws(() => createAccess({ codes: { F1: 'AAAA2345', F2: 'AAAA2345' }, secret: SECRET }), /own access code/);
  assert.throws(() => createAccess({ codes: { F1: 'short' }, secret: SECRET }), /8 characters/);
  assert.throws(() => createAccess({ codes: { F1: 'AAAA2345' }, secret: 'short' }), /SESSION_SECRET/);
  assert.throws(() => createAccess({ codes: {} }), /access code/);
});

test('daily limits per family; this computer without codes is not limited; the day starts again in China time', () => {
  let clock = Date.parse('2026-11-13T15:00:00Z'); // 23:00 in Beijing
  const ended = [];
  const usage = createUsageLimits({ limits: { ...usageLimitsFromEnv({}), replies: 2, asrConnections: 1, asrSeconds: 2 }, now: () => clock,
    onDayEnd: (day, family, counts) => ended.push([day, family, counts]) });
  assert.equal(usage.take('F1', 'replies'), true);
  assert.equal(usage.take('F1', 'replies'), true);
  assert.equal(usage.take('F1', 'replies'), false);
  assert.equal(usage.take('F2', 'replies'), true, 'families are counted apart');
  assert.equal(usage.take(null, 'replies', 1e9), true);
  const lease = usage.openRecognition('F1');
  assert.equal(usage.openRecognition('F1'), null, 'one connection at a time');
  assert.equal(lease.audio(32000), true);
  assert.equal(lease.audio(32000 * 2), false, 'audio past today\'s seconds is refused');
  lease.release();
  assert.equal(usage.openRecognition('F1'), null, 'no recognition left today');
  clock += 3600_000; // 00:00 in Beijing
  assert.equal(usage.take('F1', 'replies'), true);
  assert.deepEqual(ended, [['2026-11-13', 'F1', { replies: 2, asrSeconds: 3 }]]);
  assert.ok(usage.openRecognition('F1'));
  assert.deepEqual(usage.snapshot().F1, { replies: 1 });
  assert.equal(usageLimitsFromEnv({ USAGE_DAILY_REPLIES: '5', USAGE_DAILY_SPEECH: 'lots' }).replies, 5);
  assert.equal(usageLimitsFromEnv({ USAGE_DAILY_SPEECH: 'lots' }).speech, 600);
});

test('public mode: health check is open, everything else needs a family code, and only the app is served', async () => {
  const health = await fetch(origin + '/healthz');
  assert.deepEqual([health.status, await health.json()], [200, { ok: true }]);
  const page = await fetch(origin + '/', { redirect: 'manual' });
  assert.equal(page.headers.get('location'), '/pair');
  const paired = await pair('test-F1-2345', '203.0.113.7');
  assert.equal(paired.status, 303);
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^xiaoyu_lan=F1\./);
  assert.match(paired.headers.get('set-cookie'), /Max-Age=2592000/);
  const get = path => fetch(origin + path, { headers: { Cookie: cookie } });
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/src/bootstrap.js')).status, 200);
  for (const path of ['/rtc-lab.html', '/voice-lab.html', '/mic-check.html', '/docs/architecture/xiaoyuji-runtime.architecture.html', '/design-drafts/memory-book/index.html', '/.env']) {
    assert.equal((await get(path)).status, 404, path);
  }
  assert.equal((await (await get('/api/voice-status')).json()).rtcCall, false, 'no call mode on the public server');
  const call = await fetch(origin + '/api/rtc/call', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(call.status, 503);
});

test('public mode: a family over today\'s replies gets 429, and wrong codes lock only their own address', async () => {
  const cookie = (await pair('test-F2-6789', '198.51.100.2')).headers.get('set-cookie').split(';')[0];
  const reply = () => fetch(origin + '/api/tutor/quick', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: '虚构测试：月亮为什么会变', state: { profile: { ageBand: '4-5' }, messages: [] } }) });
  assert.equal((await reply()).status, 200);
  const refused = await reply();
  assert.deepEqual([refused.status, (await refused.json()).reason], [429, 'daily-limit']);
  for (let i = 0; i < 8; i++) assert.equal((await pair('WRONG-2345', '192.0.2.9')).status, 401);
  assert.equal((await pair('test-F2-6789', '192.0.2.9')).status, 429);
  assert.equal((await pair('test-F2-6789', '192.0.2.10')).status, 303);
});

test('public mode refuses to start without its settings', () => {
  for (const missing of ['ACCESS_CODES', 'SESSION_SECRET']) {
    const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', [missing]: '' };
    const result = spawnSync(process.execPath, ['server/server.mjs'], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, missing);
    assert.match(result.stderr, /PUBLIC_MODE needs/);
  }
  const wide = spawnSync(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: '0', HOST: '0.0.0.0' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(wide.status, 1);
});
