// PCM16 little-endian mono chunks share one playback timeline, including split samples.
// destination: where audio goes (the page output bus, so its level can be measured); default speaker.
export function createPcmPlayer(context, { sampleRate = 24000, onStart, onEnd, destination = context.destination } = {}) {
  const sources = new Set();
  let carry = null;
  let nextTime = 0;
  let received = false;
  let finished = false;
  let stopped = false;
  let startTimer = null;
  const complete = () => {
    if (finished && sources.size === 0 && !stopped) { stopped = true; onEnd?.(); }
  };
  return {
    push(chunk) {
      if (stopped) return;
      let bytes = chunk;
      if (carry !== null) { bytes = new Uint8Array(chunk.length + 1); bytes[0] = carry; bytes.set(chunk, 1); carry = null; }
      if (bytes.length % 2) carry = bytes[bytes.length - 1];
      const length = Math.floor(bytes.length / 2);
      if (!length) return;
      const buffer = context.createBuffer(1, length, sampleRate);
      const floats = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, length * 2);
      for (let i = 0; i < length; i++) floats[i] = view.getInt16(i * 2, true) / 32768;
      const source = context.createBufferSource();
      source.buffer = buffer; source.connect(destination);
      const at = Math.max(context.currentTime + 0.05, nextTime);
      nextTime = at + buffer.duration;
      sources.add(source);
      source.onended = () => { sources.delete(source); source.disconnect(); complete(); };
      source.start(at);
      if (!received) {
        received = true;
        startTimer = setTimeout(() => { if (!stopped) onStart?.(); }, (at - context.currentTime + (context.baseLatency || 0)) * 1000);
      }
    },
    finish() {
      if (carry !== null || !received) throw new Error("Incomplete PCM audio");
      finished = true; complete();
    },
    stop() {
      stopped = true; clearTimeout(startTimer);
      for (const source of sources) { source.onended = null; source.stop(); source.disconnect(); }
      sources.clear();
    },
    hasAudio: () => received,
    // Context time at which everything pushed so far will have played.
    scheduledEnd: () => nextTime
  };
}
