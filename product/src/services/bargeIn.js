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
// retrackMs: with echo cancellation the leak keeps shrinking after warm-up while the filter
// converges, so every retrackMs the coupling is re-measured and lowered (never raised: the child
// speaking only raises the ratio).
// stats() reports how the detection went, as numbers only, so a pilot session can show whether a
// missed interruption was a sensitivity problem or Xiaoyu's leak drowning the child's voice.
export function createBargeInDetector({ warmupMs = 500, minSpeechMs = 300, absolute = 0.035, ratio = 1.6, gapMs = 80, decayMs = 200, couplingPercentile = 0.75, retrackMs = 0 } = {}) {
  let startedAt = null, leak = 0, coupling = null, peak = 0, lastAt = null;
  let voiceSince = null, lastVoiceAt = null, triggered = false;
  const ratios = [];
  let windowStart = null, windowRatios = [];
  const percentile = values => { const sorted = values.sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * couplingPercentile))]; };
  const stats = { micPeak: 0, outPeak: 0, coupling: 0, thresholdMin: null, bestMargin: 0 };
  return {
    update(level, now, playback = 0) {
      if (triggered) return { triggered: false };
      const value = Number(level) || 0;
      if (startedAt === null) startedAt = now;
      // The output peak decays slowly, covering the delay and room echo between speaker and microphone.
      peak = Math.max(Number(playback) || 0, lastAt === null ? 0 : peak * Math.exp(-(now - lastAt) / decayMs));
      lastAt = now;
      stats.outPeak = Math.max(stats.outPeak, peak);
      if (now - startedAt < warmupMs) {
        leak = Math.max(leak, value);
        if (peak >= 0.01) ratios.push(value / peak);
        return { warming: true };
      }
      // A typical (not the largest) warm-up ratio: one spike would otherwise set the bar too high.
      if (coupling === null) {
        coupling = ratios.length ? percentile(ratios) : 0;
        stats.coupling = coupling;
        windowStart = now;
      }
      if (retrackMs && coupling) {
        if (peak >= 0.01) windowRatios.push(value / peak);
        if (now - windowStart >= retrackMs) {
          if (windowRatios.length >= 10) coupling = Math.min(coupling, percentile(windowRatios));
          stats.coupling = coupling;
          windowStart = now; windowRatios = [];
        }
      }
      const threshold = Math.max(absolute, coupling ? coupling * peak * ratio : leak * ratio);
      stats.micPeak = Math.max(stats.micPeak, value);
      stats.thresholdMin = stats.thresholdMin === null ? threshold : Math.min(stats.thresholdMin, threshold);
      stats.bestMargin = Math.max(stats.bestMargin, value / threshold);
      if (value >= threshold) {
        if (voiceSince === null) voiceSince = now;
        lastVoiceAt = now;
      } else if (voiceSince !== null && now - lastVoiceAt > gapMs) {
        voiceSince = null; // a short drop between syllables is tolerated, a real pause is not
      }
      if (voiceSince !== null && now - voiceSince >= minSpeechMs) { triggered = true; return { triggered: true, threshold }; }
      return { listening: true, threshold };
    },
    stats: () => ({ ...stats, thresholdMin: stats.thresholdMin ?? 0 })
  };
}

// Opens the microphone and runs the detector on every animation frame until stopped or triggered.
// Returns its handle at once, so playback that ends before the microphone opens can still stop
// it. On a trigger the stream is handed to the caller (to reuse for listening, so the child's
// next words are not lost to reopening the microphone); otherwise stop() releases it.
// context: the page's shared AudioContext, left open on release; otherwise a private one is used.
// playbackLevel: () => current output level (0–1), or nothing when it cannot be measured.
// meter(context, source): resolves to { level(), playback?(), stats?(), dispose() }; the default
// measures the microphone with an analyser. The echo-cancelling meter reports what is left after
// Xiaoyu's leak is removed, and the playback level aligned with it.
// onEnd(stats, reason): called once when monitoring ends — reason "triggered", "stopped" or "open-failed".
export function startBargeInMonitor({ openStream, AudioContextClass, context: shared = null, playbackLevel = () => 0, onTrigger, onEnd = () => {}, detector = createBargeInDetector(),
  meter: createMeter = analyserMeter, now = () => performance.now(), requestFrame = callback => window.requestAnimationFrame(callback), cancelFrame = id => window.cancelAnimationFrame(id) }) {
  let stopped = false, frame = null, context = null, stream = null, source = null, meter = null, reported = false;
  const report = reason => {
    if (reported) return;
    reported = true;
    try { onEnd({ ...(detector.stats?.() || {}), ...(meter?.stats?.() || {}) }, reason); } catch { /* diagnostics only */ }
  };
  const release = ({ keepStream = false } = {}) => {
    stopped = true;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    try { meter?.dispose(); } catch { /* already gone */ }
    source?.disconnect(); source = null;
    if (context && !shared && context.state !== "closed") context.close().catch(() => {});
    context = null;
    if (!keepStream && stream) stream.getTracks().forEach(track => track.stop());
    if (!keepStream) stream = null;
  };
  const ready = (async () => {
    try {
      const microphone = await openStream();
      if (stopped) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream = microphone;
      context = shared || new AudioContextClass();
      if (context.state === "suspended") await context.resume().catch(() => {});
      if (stopped) return;
      source = context.createMediaStreamSource(stream);
      const opened = await createMeter(context, source);
      if (stopped) { try { opened.dispose(); } catch { /* already gone */ } return; }
      meter = opened;
      const tick = () => {
        if (stopped) return;
        const playback = meter.playback ? meter.playback() : playbackLevel();
        if (detector.update(meter.level(), now(), playback).triggered) {
          const handed = stream;
          release({ keepStream: true });
          report("triggered");
          onTrigger(handed);
          return;
        }
        frame = requestFrame(tick);
      };
      tick();
    } catch {
      // Without a microphone the reply simply plays to the end, as before.
      report("open-failed");
      if (!stopped) release();
    }
  })();
  return { stop: () => { if (!stopped) { release(); report("stopped"); } }, ready };
}

function analyserMeter(context, source) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  return {
    level() {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      return Math.sqrt(sum / samples.length);
    },
    dispose() { analyser.disconnect?.(); }
  };
}
