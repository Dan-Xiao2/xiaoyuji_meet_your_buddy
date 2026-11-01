// Owns the legacy half-duplex media lifecycle, without DOM or archive access.
export function createVoiceSession({ voice, getContext, ui, narration, onInput, onTiming, onLevel, trace = () => {}, onChange = () => {},
  clock = { now: () => performance.now(), setTimeout: (fn, delay) => setTimeout(fn, delay), clearTimeout: id => clearTimeout(id) }
}) {
  let input = "idle", output = "idle", autoListen = false;
  let captureRevision = 0, playbackRevision = 0, timer = null;
  let replyMessageId = null, turnStartedAt = null;
  let failure = null, readyDetail = "";

  const emit = (type, details = {}) => trace(type, {
    sessionId: getContext().sessionId, captureRevision, playbackRevision, ...details
  });
  function listenBlock(context, automated = true) {
    if (!context.active) return "session-inactive";
    if (!context.canListen) return "not-visible";
    if (context.pending) return "pending";
    if (input !== "idle") return "input-busy";
    if (automated && !autoListen) return "disabled";
    if (automated && output !== "idle") return "output-busy";
    return null;
  }

  function clearTimer() {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }

  function stopCapture() {
    captureRevision++;
    input = "idle";
    voice.stopListening();
    onChange();
  }

  function stopOutput() {
    playbackRevision++;
    output = "idle";
    voice.stopSpeaking();
    narration.stop();
  }

  function prepareTurn() {
    clearTimer();
    stopCapture();
    stopOutput();
    failure = null; readyDetail = "";
    onChange();
  }

  function suspendAutoListen() {
    autoListen = false;
    clearTimer();
  }

  function pause({ detail = "点一下小宇，继续聊" } = {}) {
    suspendAutoListen();
    prepareTurn();
    turnStartedAt = null;
    emit("media.cancelled", { reason: "stopped" });
    readyDetail = detail;
    onChange();
  }

  function schedule(delayMs = 200) {
    clearTimer();
    const context = { ...getContext() };
    if (!autoListen || !context.active || !context.canListen || context.pending) {
      emit("media.listen-skipped", { reason: !autoListen ? "disabled" : listenBlock(context) });
      return;
    }
    emit("media.listen-scheduled", { delayMs });
    timer = clock.setTimeout(() => {
      timer = null;
      const latest = getContext();
      const reason = latest.sessionId !== context.sessionId ? "session-changed" : listenBlock(latest);
      if (reason) { emit("media.listen-skipped", { sessionId: context.sessionId, reason }); return; }
      beginInput({ automated: true });
    }, delayMs);
  }

  function resume(delayMs = 250) {
    failure = null; readyDetail = "";
    autoListen = true;
    schedule(delayMs);
    onChange();
  }

  function beginInput({ automated = false } = {}) {
    const context = { ...getContext() };
    const blocked = listenBlock(context, automated);
    if (blocked) { emit("media.listen-skipped", { reason: blocked }); return; }
    failure = null; readyDetail = "";
    ui.beforeListen();
    if (!automated) { voice.preparePlayback(); autoListen = true; }
    clearTimer();
    stopOutput();
    const revision = ++captureRevision;
    const captureIdentity = { sessionId: context.sessionId, captureRevision: revision };
    const live = (report = false) => {
      const valid = revision === captureRevision && getContext().sessionId === context.sessionId && getContext().active;
      if (!valid && report) emit("media.callback-rejected", { ...captureIdentity, reason: "stale-media" });
      return valid;
    };
    input = "capturing";
    emit("media.capture-started", captureIdentity);
    onChange();
    voice.listen({
      preferRecorder: Boolean(context.cloudTranscription && voice.recordingSupported),
      preferRealtime: Boolean(context.realtimeTranscription),
      onStart: (details = {}) => {
        if (!live(true)) return;
        if (input !== "capturing") { voice.finishListening(); return; }
        ui.captureStart(details);
      },
      onLevel: level => { if (live() && input === "capturing") onLevel(level); },
      onTiming: timing => { if (live()) onTiming(timing); },
      onProcessing: () => {
        if (!live(true)) return;
        turnStartedAt = clock.now();
        input = "processing";
        emit("media.capture-processing", captureIdentity);
        onChange();
      },
      onResult: text => { if (live()) ui.transcript(text || "正在听..."); },
      onError: message => {
        if (!live(true)) return;
        emit("media.capture-failed", captureIdentity);
        pause();
        failure = "capture";
        onChange();
        ui.captureError(message);
      },
      onIdle: () => {
        if (!live(true)) return;
        pause({ detail: "我先等一等，点我继续聊" });
        ui.transcript("");
      },
      onEnd: text => {
        if (!live(true)) return;
        emit("media.capture-completed", { ...captureIdentity, reason: text ? undefined : "empty" });
        captureRevision++;
        input = "idle";
        onChange();
        if (!text) { pause(); return; }
        onInput(text, { captureRevision: revision });
      }
    });
  }

  function finishInput() {
    if (input !== "capturing") return;
    input = "processing";
    emit("media.capture-processing");
    onChange();
    voice.finishListening();
  }

  function play({ text, steps, enabled = true, replyMessageId: messageId = null, farewell = false }) {
    clearTimer();
    stopCapture();
    stopOutput();
    failure = null; readyDetail = "";
    replyMessageId = messageId;
    ui.clearSpeechError();
    const context = { ...getContext() }, revision = playbackRevision;
    const playbackIdentity = { sessionId: context.sessionId, playbackRevision: revision, replyMessageId: messageId };
    const live = (report = false) => {
      const valid = revision === playbackRevision && getContext().sessionId === context.sessionId && (farewell || getContext().active);
      if (!valid && report) emit("media.callback-rejected", { ...playbackIdentity, reason: "stale-media" });
      return valid;
    };
    const sequence = steps || (text ? [{ text }] : []);
    if (steps?.length > 1) narration.prepare();
    if (!enabled || !sequence.length) {
      emit("media.play-skipped", { ...playbackIdentity, reason: enabled ? "empty" : "muted" });
      if (steps) narration.replay();
      readyDetail = "还想告诉我什么？"; onChange();
      if (!farewell) schedule(steps ? steps.length * 1200 : 200);
      return;
    }
    let previousEnd = null;
    function next(index) {
      if (!live(true)) return;
      if (index >= sequence.length) {
        output = "idle";
        readyDetail = farewell ? "" : "还想告诉我什么？"; onChange();
        if (!farewell) schedule();
        return;
      }
      output = "preparing";
      emit("media.play-requested", { ...playbackIdentity, segmentIndex: index });
      onChange();
      let settled = false;
      const end = () => {
        if (!live(true)) return;
        if (settled) { emit("media.callback-rejected", { ...playbackIdentity, reason: "settled", segmentIndex: index }); return; }
        settled = true;
        emit("media.play-ended", { ...playbackIdentity, segmentIndex: index });
        previousEnd = clock.now();
        next(index + 1);
      };
      const started = voice.speak(sequence[index].text, {
        onTiming: timing => { if (live() && !settled) onTiming(timing); },
        onStart: () => {
          if (!live(true)) return;
          if (settled || output === "playing") { emit("media.callback-rejected", { ...playbackIdentity, reason: "settled", segmentIndex: index }); return; }
          output = "playing";
          emit("media.play-started", { ...playbackIdentity, segmentIndex: index });
          if (steps && previousEnd !== null) {
            onTiming({ stage: "drawing-segment-gap", latencyMs: clock.now() - previousEnd });
          } else if (turnStartedAt !== null) {
            onTiming({ stage: "response-start", latencyMs: clock.now() - turnStartedAt });
            turnStartedAt = null;
          }
          if (steps) { narration.step(index); voice.prefetchSpeech(sequence[index + 1]?.text); }
          onChange();
        },
        onEnd: end,
        onError: () => {
          if (!live(true)) return;
          if (settled) { emit("media.callback-rejected", { ...playbackIdentity, reason: "settled", segmentIndex: index }); return; }
          settled = true;
          emit("media.play-failed", { ...playbackIdentity, segmentIndex: index });
          suspendAutoListen();
          stopOutput();
          if (steps) narration.replay();
          failure = "playback";
          readyDetail = "声音暂时没连上，可以再听一次。"; onChange();
          if (!farewell) ui.speechError(replyMessageId);
        }
      });
      if (!started) end();
    }
    next(0);
  }

  return {
    beginInput, finishInput, prepareTurn, pause, schedule, resume, suspendAutoListen,
    playReply: options => play(options),
    acknowledgeEnd: text => { suspendAutoListen(); play({ text, farewell: true }); },
    getSnapshot: () => Object.freeze({ sessionId: getContext().sessionId, input, output, autoListen,
      replyMessageId, captureRevision, playbackRevision, scheduled: timer !== null, failure, readyDetail })
  };
}
