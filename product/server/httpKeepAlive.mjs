import { Agent, setGlobalDispatcher } from 'undici';

// Node's fetch closes idle keep-alive sockets after ~4 s when the server sends no hint, so in a
// voice conversation every turn's model and speech requests used to open new TCP+TLS connections
// (~0.5–0.9 s each to the Beijing endpoint). The provider was measured to keep idle connections
// for at least 70 s; 30 s stays well inside that, so a request is unlikely to land on a socket the
// server has just closed, while ordinary pauses between turns keep their warm connections.
export const KEEP_ALIVE_MS = 30000;

let installed = false;
export function installKeepAliveDispatcher(env = process.env) {
  if (installed || env.PROVIDER_KEEP_ALIVE === 'false') return false;
  setGlobalDispatcher(new Agent({ keepAliveTimeout: KEEP_ALIVE_MS, keepAliveMaxTimeout: KEEP_ALIVE_MS }));
  installed = true;
  return true;
}
