// Node's fetch drops idle keep-alive sockets after about 4 s, so after a child has been speaking,
// each turn's model and speech requests would open new TCP+TLS connections (measured ~0.9 s extra
// to the Beijing endpoint). A free, authenticated model-list request just before they are needed
// leaves a warm socket in the same connection pool. It never sends child text or audio.
export function createProviderWarmup({ fetchImpl = (...args) => fetch(...args), env = process.env, timeoutMs = 3000 } = {}) {
  let inFlight = null;
  const url = env.QWEN_BASE_URL && env.QWEN_API_KEY ? `${env.QWEN_BASE_URL.replace(/\/$/, '')}/models` : null;
  return function warm() {
    if (!url || env.VOICE_LAB_WARM_CONNECTIONS === 'false') return Promise.resolve(false);
    // One warm-up at a time: a second concurrent one would only open a socket nobody uses.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${env.QWEN_API_KEY}` }, signal: AbortSignal.timeout(timeoutMs) });
        // The body must be drained, or the socket is not returned to the pool for reuse.
        await response.arrayBuffer();
        return response.ok;
      } catch { return false; }
      finally { inFlight = null; }
    })();
    return inFlight;
  };
}
