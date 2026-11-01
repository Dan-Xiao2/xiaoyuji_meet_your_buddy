// Returning the stream immediately lets SDK cancellation abort an in-flight provider request.
export function providerStream(produce) {
  const abort = new AbortController();
  return new ReadableStream({
    start(controller) {
      Promise.resolve().then(() => produce(value => {
        if (!abort.signal.aborted) controller.enqueue(value);
      }, abort.signal)).then(() => {
        if (!abort.signal.aborted) controller.close();
      }, error => {
        if (!abort.signal.aborted) controller.error(error);
      });
    },
    cancel() { abort.abort(); }
  });
}

export async function* pcmFrames(chunks, { sampleRate = 24000, signal } = {}) {
  const { AudioFrame } = await import('@livekit/rtc-node');
  const frameBytes = sampleRate / 50 * 2;
  let pending = Buffer.alloc(0);
  for await (const chunk of chunks) {
    signal?.throwIfAborted();
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= frameBytes) {
      const data = new Int16Array(frameBytes / 2);
      for (let i = 0; i < data.length; i++) data[i] = pending.readInt16LE(i * 2);
      yield new AudioFrame(data, sampleRate, 1, data.length);
      pending = pending.subarray(frameBytes);
    }
  }
  signal?.throwIfAborted();
  if (pending.length % 2) throw new Error('Incomplete PCM sample');
  if (pending.length) {
    const data = new Int16Array(pending.length / 2);
    for (let i = 0; i < data.length; i++) data[i] = pending.readInt16LE(i * 2);
    yield new AudioFrame(data, sampleRate, 1, data.length);
  }
}
