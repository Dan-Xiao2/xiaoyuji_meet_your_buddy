// With httpKeepAlive.mjs installed, provider sockets survive ordinary pauses between turns. The
// first turn, and a turn after a long pause, still start cold (~0.5–0.9 s per new TCP+TLS
// connection to the Beijing endpoint). Free, authenticated model-list requests sent when the
// child STARTS speaking open warm sockets in time. They never send child text or audio.
//
// `sockets` requests are sent concurrently, because one warm-up done after another just reuses
// the same socket. A turn needs two at once: the reply request, and then the speech request
// that starts while the background enrichment (or a still-streaming reply) holds the first.
//
// Never warm right before a reply request (for example at the final transcript): the reply,
// sent a few ms later, finds every warm socket busy with warm-up requests and opens a new
// connection (measured: first sentence 1.1–1.5 s instead of ~0.57 s).
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

