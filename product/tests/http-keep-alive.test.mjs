import test from 'node:test';
import assert from 'node:assert/strict';
import { getGlobalDispatcher, Agent } from 'undici';
import { installKeepAliveDispatcher, KEEP_ALIVE_MS } from '../server/httpKeepAlive.mjs';

test('keep-alive dispatcher can be disabled, installs once, and stays inside the provider idle window', () => {
  const before = getGlobalDispatcher();
  assert.equal(installKeepAliveDispatcher({ PROVIDER_KEEP_ALIVE: 'false' }), false);
  assert.equal(getGlobalDispatcher(), before);
  assert.equal(installKeepAliveDispatcher({}), true);
  assert.ok(getGlobalDispatcher() instanceof Agent);
  assert.equal(installKeepAliveDispatcher({}), false, 'a second install keeps the existing pool');
  // The provider kept idle sockets for at least 70 s; a longer client timeout risks a request
  // being written to a socket the server has just closed.
  assert.ok(KEEP_ALIVE_MS > 4000 && KEEP_ALIVE_MS <= 60000);
});
