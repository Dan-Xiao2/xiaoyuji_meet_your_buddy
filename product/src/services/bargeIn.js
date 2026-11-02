// Lets a child interrupt Xiaoyu by speaking while a reply is playing (half-duplex barge-in).
// The monitoring microphone runs WITHOUT the system's echo cancellation: on an iPhone, recording
// with echo cancellation while playing switches to call audio, and Xiaoyu sounded muffled with an
// electric noise (confirmed by turning barge-in off). So Xiaoyu's own voice leaks into the
// microphone, and the detector compares the microphone with what is playing right now:
// `playback` is the current output level. The first `warmupMs` estimate how much of the output
// reaches the microphone (coupling); afterwards only sound clearly above coupling × the recent
// output peak, sustained for `minSpeechMs`, counts as the child speaking. Without a playback level
// it falls back to the loudest leak heard during warm-up. Interruptions that end with nothing
// recognised ("barge-in-empty") are recorded to measure false triggers.
export function createBargeInDetector({ warmupMs = 500, minSpeechMs = 300, absolute = 0.035, ratio = 1.6, gapMs = 80, decayMs = 200 } = {}) {
  let startedAt = null, leak = 0, coupling = 0, peak = 0, lastAt = null;
  let voiceSince = null, lastVoiceAt = null, triggered = false;
  return {
    update(level, now, playback = 0) {
      if (triggered) return { triggered: false };
      const value = Number(level) || 0;
      if (startedAt === null) startedAt = now;
      // The output peak decays slowly, covering the delay and room echo between speaker and microphone.
      peak = Math.max(Number(playback) || 0, lastAt === null ? 0 : peak * Math.exp(-(now - lastAt) / decayMs));
      lastAt = now;
      if (now - startedAt < warmupMs) {
        leak = Math.max(leak, value);
        if (peak >= 0.01) coupling = Math.max(coupling, value / peak);
        return { warming: true };
      }
      const threshold = Math.max(absolute, coupling ? coupling * peak * ratio : leak * ratio);
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
// context: the page's shared AudioContext, left open on release; otherwise a private one is used.
// playbackLevel: () => current output level (0–1), or nothing when it cannot be measured.
export function startBargeInMonitor({ openStream, AudioContextClass, context: shared = null, playbackLevel = () => 0, onTrigger, detector = createBargeInDetector(),
  now = () => performance.now(), requestFrame = callback => window.requestAnimationFrame(callback), cancelFrame = id => window.cancelAnimationFrame(id) }) {
  let stopped = false, frame = null, context = null, stream = null, source = null;
  const release = ({ keepStream = false } = {}) => {
    stopped = true;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    source?.disconnect(); source = null;
    if (context && !shared && context.state !== "closed") context.close().catch(() => {});
    context = null;
    if (!keepStream && stream) stream.getTracks().forEach(track => track.stop());
    if (!keepStream) stream = null;
  };
  const ready = (async () => {
    try {
      const opened = await openStream();
      if (stopped) { opened.getTracks().forEach(track => track.stop()); return; }
      stream = opened;
      context = shared || new AudioContextClass();
      if (context.state === "suspended") await context.resume().catch(() => {});
      if (stopped) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (stopped) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        if (detector.update(Math.sqrt(sum / samples.length), now(), playbackLevel()).triggered) {
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
