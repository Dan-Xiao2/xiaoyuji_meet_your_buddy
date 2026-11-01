// Lets a child interrupt Xiaoyu by speaking while a reply is playing (half-duplex barge-in).
// The microphone runs with the browser's echo cancellation, but some of Xiaoyu's own voice can
// still leak in, especially on a phone speaker. The first `warmupMs` of playback measure that
// leak; afterwards only sound clearly louder than it, sustained for `minSpeechMs`, counts as the
// child speaking. False triggers are expected to be rare but not impossible, so callers record
// interruptions that end with nothing recognised ("barge-in-empty") to measure them.
export function createBargeInDetector({ warmupMs = 500, minSpeechMs = 300, absolute = 0.035, ratio = 1.6, gapMs = 80 } = {}) {
  let startedAt = null, leak = 0, voiceSince = null, lastVoiceAt = null, triggered = false;
  return {
    update(level, now) {
      if (triggered) return { triggered: false };
      const value = Number(level) || 0;
      if (startedAt === null) startedAt = now;
      if (now - startedAt < warmupMs) { leak = Math.max(leak, value); return { warming: true }; }
      const threshold = Math.max(absolute, leak * ratio);
      if (value >= threshold) {
        if (voiceSince === null) voiceSince = now;
        lastVoiceAt = now;
      } else if (voiceSince !== null && now - lastVoiceAt > gapMs) {
        voiceSince = null; // a short drop between syllables is tolerated, a real pause is not
      }
      if (voiceSince !== null && now - voiceSince >= minSpeechMs) { triggered = true; return { triggered: true, threshold }; }
      return { listening: true, threshold };
    }
  };
}

// Opens the microphone and runs the detector on every animation frame until stopped or triggered.
// Returns its handle at once, so playback that ends before the microphone opens can still stop
// it. On a trigger the stream is handed to the caller (to reuse for listening, so the child's
// next words are not lost to reopening the microphone); otherwise stop() releases it.
export function startBargeInMonitor({ openStream, AudioContextClass, onTrigger, detector = createBargeInDetector(),
  now = () => performance.now(), requestFrame = callback => window.requestAnimationFrame(callback), cancelFrame = id => window.cancelAnimationFrame(id) }) {
  let stopped = false, frame = null, context = null, stream = null;
  const release = ({ keepStream = false } = {}) => {
    stopped = true;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    if (context && context.state !== "closed") context.close().catch(() => {});
    context = null;
    if (!keepStream && stream) stream.getTracks().forEach(track => track.stop());
    if (!keepStream) stream = null;
  };
  const ready = (async () => {
    try {
      const opened = await openStream();
      if (stopped) { opened.getTracks().forEach(track => track.stop()); return; }
      stream = opened;
      context = new AudioContextClass();
      if (context.state === "suspended") await context.resume().catch(() => {});
      if (stopped) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (stopped) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        if (detector.update(Math.sqrt(sum / samples.length), now()).triggered) {
          const handed = stream;
          release({ keepStream: true });
          onTrigger(handed);
          return;
        }
        frame = requestFrame(tick);
      };
      tick();
    } catch {
      // Without a microphone the reply simply plays to the end, as before.
      if (!stopped) release();
    }
  })();
  return { stop: () => { if (!stopped) release(); }, ready };
}
