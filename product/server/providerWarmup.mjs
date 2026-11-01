// Node's fetch drops idle keep-alive sockets after about 4 s, so after a child has been speaking,
// each turn's model and speech requests would open new TCP+TLS connections (measured ~0.9 s extra
// to the Beijing endpoint). Free, authenticated model-list requests just before they are needed
// leave warm sockets in the same connection pool. They never send child text or audio.
//
// `sockets` requests are sent concurrently, because one warm-up done after another just reuses
// the same socket. A turn needs two at once: the reply request, and then the speech request
// that starts while the background enrichment (or a still-streaming reply) holds the first.
export function createProviderWarmup({ fetchImpl = (...args) => fetch(...args), env = process.env, timeoutMs = 3000, sockets = 2 } = {}) {
  let inFlight = null;
  const url = env.QWEN_BASE_URL && env.QWEN_API_KEY ? `${env.QWEN_BASE_URL.replace(/\/$/, '')}/models` : null;
  const disabled = () => env.PROVIDER_WARM_CONNECTIONS === 'false' || env.VOICE_LAB_WARM_CONNECTIONS === 'false';
  const once = async () => {
    try {
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${env.QWEN_API_KEY}` }, signal: AbortSignal.timeout(timeoutMs) });
      // The body must be drained, or the socket is not returned to the pool for reuse.
      await response.arrayBuffer();
      return response.ok;
    } catch { return false; }
  };
  return function warm() {
    if (!url || disabled()) return Promise.resolve(false);
    // One batch at a time: a second concurrent batch would only open sockets nobody uses.
    if (inFlight) return inFlight;
    inFlight = Promise.all(Array.from({ length: sockets }, once))
      .then(results => results.every(Boolean))
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}
