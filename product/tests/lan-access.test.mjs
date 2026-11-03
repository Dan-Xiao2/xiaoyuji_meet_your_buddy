import test from 'node:test';
import assert from 'node:assert/strict';
import { createLanAccess, pairPage } from '../server/lanAccess.mjs';
import { accessCode, lanAddress } from '../scripts/run-pilot-lan.mjs';

const request = (address, cookie) => ({ socket: { remoteAddress: address }, headers: cookie ? { cookie } : {} });

test('every client, including loopback proxies, needs a paired session cookie that does not contain the code', () => {
  const access = createLanAccess({ code: 'ABCD2345' });
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(access.authorized(request(address)), false);
    assert.equal(access.authorized(request(address, 'xiaoyu_lan=forged')), false);
  }
  assert.equal(access.authorized(request('192.168.1.20')), false);
  assert.equal(access.authorized(request('192.168.1.20', 'xiaoyu_lan=forged')), false);
  const paired = access.pair(' ABCD2345 ');
  assert.equal(paired.ok, true);
  assert.match(paired.cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(paired.cookie.includes('ABCD2345'), false);
  const session = paired.cookie.split(';')[0];
  for (const address of ['192.168.1.20', '127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(access.authorized(request(address, `other=1; ${session}`)), true);
  }
});

test('sessions expire and repeated wrong codes lock pairing, even for the right code', () => {
  let clock = 0;
  const access = createLanAccess({ code: 'ABCD2345', now: () => clock, sessionMs: 1000, maxFailures: 3, lockMs: 5000 });
  const session = access.pair('ABCD2345').cookie.split(';')[0];
  clock = 1001;
  for (const address of ['192.168.1.20', '127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(access.authorized(request(address, session)), false);
  }
  for (let i = 0; i < 3; i++) assert.equal(access.pair('WRONG123').reason, 'wrong-code');
  assert.equal(access.pair('ABCD2345').reason, 'locked');
  clock += 5000;
  assert.equal(access.pair('ABCD2345').ok, true);
});

test('weak codes are refused; the pairing page never echoes a code; generated codes avoid look-alike characters', () => {
  assert.throws(() => createLanAccess({ code: 'short' }));
  assert.equal(pairPage('访问码不对').includes('ABCD2345'), false);
  for (let i = 0; i < 50; i++) assert.match(accessCode(), /^[A-HJKMNP-Z2-9]{8}$/);
});

test('LAN address prefers Wi-Fi/Ethernet over virtual adapters and ignores loopback', () => {
  assert.equal(lanAddress({ lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    utun3: [{ family: 'IPv4', internal: false, address: '10.8.0.2' }],
    en0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }, { family: 'IPv4', internal: false, address: '192.168.1.251' }] }), '192.168.1.251');
  assert.equal(lanAddress({}), null);
});
