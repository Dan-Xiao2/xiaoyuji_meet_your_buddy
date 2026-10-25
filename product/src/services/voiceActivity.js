export function createVoiceActivityDetector(options = {}) {
  const threshold = numberOption(options.threshold, 0.015);
  const startFrames = numberOption(options.startFrames, 3);
  const silenceDurationMs = numberOption(options.silenceDurationMs, 1050);
  const idleTimeoutMs = numberOption(options.idleTimeoutMs, 90000);
  const minSpeechMs = numberOption(options.minSpeechMs, 360);
  const maxSpeechMs = numberOption(options.maxSpeechMs, 15000);
  let startedAt = null;
  let speechStartedAt = null;
  let lastVoiceAt = null;
  let loudFrames = 0;
  let completed = false;

  function update(level, now = Date.now()) {
    if (completed) return { completed: true };
    if (startedAt === null) startedAt = now;
    const isVoice = Number(level) >= threshold;

    if (speechStartedAt === null) {
      loudFrames = isVoice ? loudFrames + 1 : 0;
      if (loudFrames >= startFrames) {
        speechStartedAt = now;
        lastVoiceAt = now;
        return { speechStarted: true, isVoice: true };
      }
      if (now - startedAt >= idleTimeoutMs) {
        completed = true;
        return { idle: true, completed: true };
      }
      return { waiting: true, isVoice };
    }

    if (isVoice) lastVoiceAt = now;
    const speechDurationMs = now - speechStartedAt;
    if (speechDurationMs >= maxSpeechMs) {
      completed = true;
      return { shouldStop: true, reason: "max-speech", completed: true };
    }
    if (speechDurationMs >= minSpeechMs && now - lastVoiceAt >= silenceDurationMs) {
      completed = true;
      return { shouldStop: true, reason: "silence", silenceMs: now - lastVoiceAt, completed: true };
    }
    return { listening: true, isVoice };
  }

  return {
    update,
    hasSpeech: () => speechStartedAt !== null
  };
}

function numberOption(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
