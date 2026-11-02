import { joinUtterance, looksUnfinished } from "./utteranceCompletion.js";

// Owns the legacy half-duplex media lifecycle, without DOM or archive access.
export function createVoiceSession({ voice, getContext, ui, narration, onInput, onTiming, onLevel, trace = () => {}, onChange = () => {}, onBargeIn = () => {},
  clock = { now: () => performance.now(), setTimeout: (fn, delay) => setTimeout(fn, delay), clearTimeout: id => clearTimeout(id) }
}) {
  let input = "idle", output = "idle", autoListen = false;
  let captureRevision = 0, playbackRevision = 0, timer = null;
  let replyMessageId = null, turnStartedAt = null;
  let failure = null, readyDetail = "";
  // Barge-in: while a reply plays, a speaking child stops it and is listened to (context.bargeIn).
  let bargeWatch = null, playStartedAt = null;
  // A voice interruption waiting for the recogniser to hear a character: { revision } of the
  // playback that goes on quietly meanwhile. rearmWatch listens again if it was not the child.
  let tentative = null, rearmWatch = null;
  // A transcript that stopped mid-thought, waiting for the rest (at most MAX_HOLDS times per turn).
  let heldText = "", holds = 0;
  const MAX_HOLDS = 2, CONTINUE_WAIT_MS = 4000;

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

  function stopWatch() {
    bargeWatch?.stop();
    bargeWatch = null;
  }

  // Before playback stops: which whole sentences the child heard (streamed replies only). A reply
  // whose every sentence had already played (only its tail was left) is not marked.
  function markInterrupted() {
    const delivery = voice.heardSoFar?.() || null;
    if (delivery?.complete) return;
    onBargeIn(replyMessageId, delivery ? { heard: delivery.heard } : {});
  }

  function stopOutput() {
    tentative = null; rearmWatch = null;
    stopWatch();
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
    heldText = ""; holds = 0;
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

  // The recogniser heard a character during a tentative interruption: now Xiaoyu stops.
  function confirmBargeIn() {
    const pending = tentative;
    tentative = null;
    if (!pending || pending.revision !== playbackRevision || output === "idle") return;
    onTiming({ stage: "barge-in-confirmed", latencyMs: clock.now() - playStartedAt });
    if (replyMessageId) markInterrupted();
    stopOutput();
    onChange();
  }

  // Nothing was recognised: it was not the child. Xiaoyu's volume comes back and she listens for
  // an interruption again; if her reply ended meanwhile, listening resumes as after any reply.
  function dismissBargeIn() {
    const pending = tentative;
    tentative = null;
    voice.duckPlayback?.(false);
    onTiming({ stage: "barge-in-dismissed", latencyMs: 0 });
    if (!pending || pending.revision !== playbackRevision || output === "idle") { schedule(); return; }
    rearmWatch?.();
    onChange();
  }

  function beginInput({ automated = false, afterBargeIn = false, continuing = false, tentative: provisional = false } = {}) {
    const context = { ...getContext() };
    const blocked = listenBlock(context, automated);
    if (blocked) { emit("media.listen-skipped", { reason: blocked }); return; }
    failure = null; readyDetail = "";
    ui.beforeListen();
    if (!automated) { voice.preparePlayback(); autoListen = true; }
    // Tapping to talk while Xiaoyu speaks also cuts the reply short; the next turn must know.
    if (!automated && !afterBargeIn && output === "playing" && replyMessageId) markInterrupted();
    clearTimer();
    if (!provisional) stopOutput();
    // afterBargeIn: a capture that follows a barge-in and hears nothing suggests a false trigger.
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
      asrCorpus: context.asrCorpus || "",
      // While waiting for the rest of a held sentence, give up after a short silence.
      ...(continuing ? { noSpeechTimeoutMs: CONTINUE_WAIT_MS } : {}),
      onStart: (details = {}) => {
        if (!live(true)) return;
        if (input !== "capturing") { voice.finishListening(); return; }
        ui.captureStart(details);
        if (continuing) ui.transcript("我在听，你接着说。");
      },
      onLevel: level => { if (live() && input === "capturing") onLevel(level); },
      onHeard: () => { if (live() && provisional) confirmBargeIn(); },
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
        // "Xiaoyu did not hear me" cases are counted for the family pilot: errors, no speech, nothing recognised.
        onTiming({ stage: "capture-error", latencyMs: 0 });
        if (provisional && tentative) { stopCapture(); dismissBargeIn(); return; }
        emit("media.capture-failed", captureIdentity);
        pause();
        failure = "capture";
        onChange();
        ui.captureError(message);
      },
      onIdle: () => {
        if (!live(true)) return;
        if (heldText) { release(revision); return; }
        onTiming({ stage: "capture-idle", latencyMs: 0 });
        if (afterBargeIn) onTiming({ stage: "barge-in-empty", latencyMs: 0 });
        if (provisional && tentative) { stopCapture(); ui.transcript(""); dismissBargeIn(); return; }
        pause({ detail: "我先等一等，点我继续聊" });
        ui.transcript("");
      },
      onEnd: text => {
        if (!live(true)) return;
        emit("media.capture-completed", { ...captureIdentity, reason: text ? undefined : "empty" });
        captureRevision++;
        input = "idle";
        onChange();
        if (!text) {
          if (heldText) { release(revision); return; }
          onTiming({ stage: "capture-empty", latencyMs: 0 });
          if (afterBargeIn) onTiming({ stage: "barge-in-empty", latencyMs: 0 });
          if (provisional && tentative) { dismissBargeIn(); return; }
          pause(); return;
        }
        // Recognised text without the early signal (batch recognition): the child it was.
        if (provisional && tentative) confirmBargeIn();
        const said = joinUtterance(heldText, text);
        if (looksUnfinished(said) && holds < MAX_HOLDS) {
          heldText = said; holds++;
          onTiming({ stage: "utterance-held", latencyMs: 0 });
          beginInput({ continuing: true });
          return;
        }
        heldText = ""; holds = 0;
        onInput(said, { captureRevision: revision });
      }
    });
  }

  // Starts speaking a reply whose sentences are still arriving (see voice.speakSentences). Returns
  // { push(text), end(), attach(replyMessageId), cancel() }; all are ignored once this playback has
  // been replaced or stopped. attach links the playback to the committed reply message.
  function playStreamingReply({ enabled = true } = {}) {
    let sink = null, ended = false;
    const pending = [];
    play({ enabled, stream: { start: (_, callbacks) => {
      sink = voice.speakSentences(callbacks);
      for (const text of pending.splice(0)) sink.push(text);
      if (ended) sink.end();
      return true;
    } } });
    const revision = playbackRevision;
    const live = () => revision === playbackRevision;
    return {
      push(text) { if (!live() || ended) return; if (sink) sink.push(text); else pending.push(text); },
      end() { if (!live() || ended) return; ended = true; sink?.end(); },
      attach(id) { if (live()) replyMessageId = id; },
      cancel() { if (live()) { stopOutput(); onChange(); } }
    };
  }

  // The child said no more after a held fragment: answer what was said.
  function release(revision) {
    const said = heldText;
    heldText = ""; holds = 0;
    captureRevision++;
    input = "idle";
    turnStartedAt = clock.now();
    onChange();
    onInput(said, { captureRevision: revision });
  }

  function finishInput() {
    if (input !== "capturing") return;
    input = "processing";
    emit("media.capture-processing");
    onChange();
    voice.finishListening();
  }

  // stream: optional replacement for voice.speak, used by playStreamingReply for a reply that is
  // still arriving; everything else (timing, barge-in, auto-listen, failure) is shared.
  function play({ text, steps, enabled = true, replyMessageId: messageId = null, farewell = false, stream = null }) {
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
    const sequence = steps || (text || stream ? [{ text: text || "" }] : []);
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
        stopWatch();
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
      const started = (stream ? stream.start : voice.speak)(sequence[index].text, {
        onTiming: timing => { if (live() && !settled) onTiming(timing); },
        onStart: () => {
          if (!live(true)) return;
          if (settled || output === "playing") { emit("media.callback-rejected", { ...playbackIdentity, reason: "settled", segmentIndex: index }); return; }
          output = "playing";
          emit("media.play-started", { ...playbackIdentity, segmentIndex: index });
          const startWatch = () => {
            if (bargeWatch || farewell || !context.bargeIn || !voice.watchForBargeIn) return;
            bargeWatch = voice.watchForBargeIn(() => {
              bargeWatch = null;
              if (!live(true) || output === "idle") return;
              onTiming({ stage: "barge-in", latencyMs: clock.now() - playStartedAt });
              emit("media.barge-in", playbackIdentity);
              // A loud sound is not yet the child (a dog's bark stopped Xiaoyu in the pilot): she goes
              // quiet and listening starts; she stops once a character is recognised, or carries on.
              if (voice.duckPlayback?.(true)) { tentative = { revision }; beginInput({ afterBargeIn: true, tentative: true }); return; }
              // The child did not hear the rest of this reply; the next model turn must know that.
              // Read at trigger time: a streamed reply is attached to its message only once committed.
              if (replyMessageId) markInterrupted();
              beginInput({ afterBargeIn: true });
            }, { onEnd: (stats, reason) => onTiming({ stage: "barge-in-watch", latencyMs: clock.now() - playStartedAt, reason, levels: stats }) });
          };
          if (!bargeWatch && !farewell && context.bargeIn && voice.watchForBargeIn) {
            playStartedAt = clock.now();
            rearmWatch = () => { if (live()) startWatch(); };
            startWatch();
          }
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
    playStreamingReply,
    acknowledgeEnd: text => { suspendAutoListen(); play({ text, farewell: true }); },
    getSnapshot: () => Object.freeze({ sessionId: getContext().sessionId, input, output, autoListen,
      replyMessageId, captureRevision, playbackRevision, scheduled: timer !== null, failure, readyDetail })
  };
}
