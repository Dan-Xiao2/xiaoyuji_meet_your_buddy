import { createVoiceActivityDetector } from "./voiceActivity.js";
import { createPcmPlayer } from "./pcmPlayer.js";
import { cropRecordedAudio } from "./recordedAudio.js";
import { createRealtimeCapture } from "./realtimeAsr.js";
import { getMicrophoneId, openMicrophone, microphoneError } from "./microphoneInput.js";
import { createBargeInDetector, startBargeInMonitor } from "./bargeIn.js";

export function createVoiceController() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognitionSupported = Boolean(SpeechRecognition);
  const browserSpeechSupported = "speechSynthesis" in window;
  const speechSupported = browserSpeechSupported || typeof window.Audio === "function";
  const recordingSupported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  const secureEnough = window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  let recognition = null;
  let recorder = null;
  let stream = null;
  let stopTimer = null;
  let finishRequested = false;
  let meterContext = null;
  let meterSource = null;
  let meterFrame = null;
  let meterStream = null;
  let meterOwnsStream = false;
  let meterRequestId = 0;
  let speechRequestId = 0;
  let speechFetchController = null;
  let preparedSpeech = null;
  let audioPlayer = null;
  let audioObjectUrl = "";
  let listeningRequestId = 0;
  let playbackContext = null;
  let pcmPlayer = null;
  let transcriptionController = null;
  let realtimeCapture = null;
  // A microphone stream opened by the barge-in monitor, waiting to be reused by the next capture.
  let handoffStream = null;
  let handoffTimer = null;

  function dropHandoff() {
    window.clearTimeout(handoffTimer);
    handoffTimer = null;
    handoffStream?.getTracks().forEach((track) => track.stop());
    handoffStream = null;
  }

  function takeHandoff() {
    const next = handoffStream;
    window.clearTimeout(handoffTimer);
    handoffTimer = null;
    handoffStream = null;
    if (next?.getAudioTracks()[0]?.readyState === "live") return next;
    next?.getTracks().forEach((track) => track.stop());
    return null;
  }

  // While a reply plays, listen for the child starting to speak. onBargeIn is called once; the
  // open stream is kept briefly for the capture that follows (unused, it is released after 2 s).
  // With streamed playback the microphone opens without the system's echo cancellation (on an
  // iPhone it switches to call audio: electric noise) and goes through the page's own echo
  // canceller, which removes Xiaoyu's leak using what is playing; the detector listens to what is
  // left. The whole-file fallback plays outside the page's audio graph, so it keeps the system's.
  // A raw stream is not handed to the following capture: without gain control a quiet child could
  // be missed, so listening reopens the microphone with normal processing.
  // onEnd(stats, reason) reports how detection went (numbers only), for the family pilot.
  function watchForBargeIn(onBargeIn, { onEnd = () => {} } = {}) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!recordingSupported || !secureEnough || !AudioContextClass) return { stop() {} };
    const referenced = Boolean(pcmPlayer && outputAnalyser);
    // Without the canceller, level alone could not tell the child (~0.006–0.01 RMS on an iPhone)
    // from Xiaoyu's leak plus room echo (~0.004–0.006): it missed the child or stopped Xiaoyu by
    // itself (pilot, 2026-11-02). So without AudioWorklet the streamed path only allows tapping.
    if (referenced && !(sharedAudioContext()?.audioWorklet && window.AudioWorkletNode)) return { stop() {} };
    // Settings from a simulation with real speech, room echo and speaker distortion: the coupling
    // is re-measured every second as the canceller converges, at the 90th percentile and twice
    // over, which kept Xiaoyu from interrupting herself while still catching the child in ~0.3 s.
    const detector = createBargeInDetector(referenced ? { absolute: 0.004, gapMs: 150, ratio: 2, couplingPercentile: 0.9, retrackMs: 1000 } : { absolute: 0.035 });
    return startBargeInMonitor({ openStream: () => openMicrophone({ voiceProcessing: !referenced }), AudioContextClass, detector,
      onEnd: (stats, reason) => onEnd({ ...stats, echoCancellation: referenced ? 0 : 1 }, reason),
      ...(referenced ? { meter: echoCancellingMeter } : {}),
      context: sharedAudioContext(), playbackLevel: referenced ? playbackLevel : () => 0, onTrigger: (opened) => {
        dropHandoff();
        if (referenced) opened.getTracks().forEach((track) => track.stop());
        else { handoffStream = opened; handoffTimer = window.setTimeout(dropHandoff, 2000); }
        onBargeIn();
      } });
  }

  // The raw microphone and the output bus go into the echo canceller worklet, which reports levels
  // every 16 ms. What it learnt about the echo path is kept for the next reply.
  let echoModule = null, echoMemory = null;
  async function echoCancellingMeter(context, source) {
    if (!echoModule || echoModule.context !== context) {
      echoModule = { context, ready: context.audioWorklet.addModule(new URL("./echoCancellerWorklet.js", import.meta.url)) };
      echoModule.ready.catch(() => { echoModule = null; });
    }
    await echoModule.ready;
    const node = new window.AudioWorkletNode(context, "echo-canceller", { numberOfInputs: 2, numberOfOutputs: 0,
      channelCount: 1, channelCountMode: "explicit", processorOptions: echoMemory || {} });
    const latest = { residual: 0, reference: 0, delayMs: 0 }, totals = { mic: 0, residual: 0 };
    node.port.onmessage = ({ data }) => {
      if (data?.type === "state") { echoMemory = { weights: data.weights, delay: data.delay, offset: data.offset }; node.port.close(); return; }
      if (data?.type !== "level") return;
      latest.residual = data.residual; latest.reference = data.reference; latest.delayMs = data.delayMs;
      if (data.reference > 0.001) { totals.mic += data.mic * data.mic; totals.residual += data.residual * data.residual; }
    };
    const reference = outputBus;
    source.connect(node, 0, 0);
    reference?.connect(node, 0, 1);
    return {
      level: () => latest.residual,
      playback: () => latest.reference,
      stats: () => ({ echoReduction: totals.residual > 0 ? 10 * Math.log10(totals.mic / totals.residual) : 0, echoDelayMs: latest.delayMs }),
      dispose() {
        try { source.disconnect(node); } catch { /* already disconnected */ }
        try { reference?.disconnect(node); } catch { /* already disconnected */ }
        node.port.postMessage("stop");
      }
    };
  }

  // Output bus on the shared context: streamed speech goes through it so its level can be read.
  let outputBus = null, outputAnalyser = null, outputSamples = null;
  function playbackOutput() {
    const context = sharedAudioContext();
    if (!context) return undefined;
    if (!outputBus || outputBus.context !== context) {
      try {
        outputBus = context.createGain();
        outputAnalyser = context.createAnalyser();
        outputAnalyser.fftSize = 1024;
        outputSamples = new Float32Array(outputAnalyser.fftSize);
        outputBus.connect(context.destination);
        outputBus.connect(outputAnalyser);
      } catch { outputBus = null; outputAnalyser = null; return context.destination; }
    }
    return outputBus;
  }
  function playbackLevel() {
    if (!outputAnalyser) return 0;
    outputAnalyser.getFloatTimeDomainData(outputSamples);
    let sum = 0;
    for (const sample of outputSamples) sum += sample * sample;
    return Math.sqrt(sum / outputSamples.length);
  }

  // One AudioContext for the whole page: playback, the level meter, realtime capture and barge-in.
  // On an iPhone, chat used up to four contexts at once around the microphone and the child heard
  // crackling "electric" noise while speaking; the microphone test with one context had none.
  function sharedAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try { playbackContext ||= new AudioContextClass(); } catch { return null; }
    return playbackContext;
  }

  function preparePlayback() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      playbackContext ||= new AudioContextClass();
      // iOS Safari also has "interrupted" (after the microphone or audio session changes), not only "suspended".
      if (playbackContext.state !== "running" && playbackContext.state !== "closed") playbackContext.resume().catch(() => {});
    } catch { /* Whole-response cloud audio remains available. */ }
  }

  function listen({ onStart, onResult, onError, onEnd, onIdle, onLevel, onTiming, onProcessing, preferRecorder = false, preferRealtime = false, asrCorpus = "", noSpeechTimeoutMs }) {
    stopListening();
    finishRequested = false;
    const requestId = listeningRequestId;

    if (getMicrophoneId() && !preferRecorder && recognitionSupported) {
      onError?.("所选麦克风需要云端语音识别。请检查语音服务，或在家庭设置中选择跟随系统。");
      return;
    }

    if (preferRecorder && recordingSupported) {
      listenWithRecorder({ onStart, onResult, onError, onEnd, onIdle, onLevel, onTiming, onProcessing, preferRealtime, asrCorpus, noSpeechTimeoutMs }, requestId);
      return;
    }

    if (!recognitionSupported) {
      listenWithRecorder({ onStart, onResult, onError, onEnd, onIdle, onLevel, onTiming, onProcessing }, requestId);
      return;
    }

    startLevelMeter(onLevel);

    recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = false;

    let finalText = "";
    let hadError = false;
    recognition.onstart = () => {
      if (requestId === listeningRequestId) onStart?.();
    };
    recognition.onerror = () => {
      if (requestId !== listeningRequestId) return;
      hadError = true;
      stopLevelMeter();
      onError?.("没有听清楚，可以再说一次，或让家长帮忙输入。");
    };
    recognition.onend = () => {
      if (requestId !== listeningRequestId) return;
      stopLevelMeter();
      if (!hadError) onEnd?.(finalText);
    };
    recognition.onresult = (event) => {
      if (requestId !== listeningRequestId) return;
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript.trim();
        if (event.results[index].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      onResult?.(finalText || interimText);
    };

    try {
      recognition.start();
    } catch {
      stopLevelMeter();
      onError?.("语音识别启动失败。请刷新页面，或先用下方演示入口。");
    }
  }

  function stopListening() {
    listeningRequestId += 1;
    transcriptionController?.abort();
    transcriptionController = null;
    realtimeCapture?.cancel();
    realtimeCapture = null;
    stopLevelMeter();
    if (stopTimer) window.clearTimeout(stopTimer);
    stopTimer = null;
    if (recognition) recognition.abort();
    recognition = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    finishRequested = false;
  }

  function finishListening() {
    finishRequested = true;
    stopLevelMeter();
    if (stopTimer) window.clearTimeout(stopTimer);
    stopTimer = null;

    if (recognition) {
      recognition.stop();
      recognition = null;
      return;
    }

    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function listenWithRecorder({ onStart, onResult, onError, onEnd, onIdle, onLevel, onTiming, onProcessing, preferRealtime = false, asrCorpus = "", noSpeechTimeoutMs }, requestId) {
    if (!secureEnough) {
      onError?.("浏览器要求在 localhost 或 HTTPS 页面里使用麦克风。请用本地预览地址打开。");
      return;
    }

    if (!recordingSupported) {
      onError?.("当前浏览器不能打开麦克风。明天演示可以先点下方三个大入口。");
      return;
    }

    try {
      const nextStream = takeHandoff() || await openMicrophone();
      if (requestId !== listeningRequestId || finishRequested) {
        nextStream.getTracks().forEach((track) => track.stop());
        if (requestId === listeningRequestId) onEnd?.("");
        return;
      }
      stream = nextStream;
      stream.getAudioTracks()[0].onended = () => {
        if (requestId !== listeningRequestId) return;
        stopListening();
        onError?.("麦克风已断开，请在家庭设置中重新选择。");
      };
    } catch (error) {
      if (requestId !== listeningRequestId) return;
      onError?.(microphoneError(error));
      return;
    }

    // MediaRecorder chunks form one container; dropping middle chunks corrupts its timeline.
    const recordedChunks = [];
    let captureStartedAt = 0;
    let speechStartOffsetMs = 0;
    const activity = createVoiceActivityDetector(noSpeechTimeoutMs ? { idleTimeoutMs: noSpeechTimeoutMs } : {});
    let speechDetected = false;
    let stopReason = "manual";
    const mimeType = pickMimeType();
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      cleanupRecorderOnly();
      onError?.("录音没有启动，请检查麦克风或换一个浏览器再试。");
      return;
    }

    let realtime = null;
    if (preferRealtime) {
      try {
        realtime = await createRealtimeCapture(stream, { onTiming, corpus: asrCorpus, context: sharedAudioContext() });
        if (requestId !== listeningRequestId || finishRequested) {
          realtime.cancel();
          if (requestId === listeningRequestId) { cleanupRecorderOnly(); onEnd?.(""); }
          return;
        }
        realtimeCapture = realtime;
      } catch {
        if (requestId !== listeningRequestId) return;
        onTiming?.({ stage: "asr-realtime-fallback", reason: "capture-unavailable", latencyMs: 0 });
      }
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size <= 0) return;
      recordedChunks.push(event.data);
    };
    recorder.onerror = () => {
      if (requestId !== listeningRequestId) return;
      stopListening();
      onError?.("录音中断了，请再说一次。");
    };

    recorder.onstop = async () => {
      if (requestId !== listeningRequestId) return;
      const recordedMimeType = recorder?.mimeType || "audio/webm";
      if (!speechDetected || !recordedChunks.length) {
        realtime?.cancel();
        cleanupRecorderOnly();
        if (stopReason === "idle") {
          onIdle?.();
        } else {
          onEnd?.("");
        }
        return;
      }

      // Release the microphone and change feedback as soon as recording ends, not after ASR.
      const realtimeResult = realtime?.finish();
      cleanupRecorderOnly();
      onProcessing?.();
      onResult?.("小宇正在把声音转成文字...");
      if (realtimeResult) {
        const startedAt = window.performance.now();
        const result = await realtimeResult;
        if (requestId !== listeningRequestId) return;
        realtimeCapture = null;
        onTiming?.({ stage: "asr-realtime-final", latencyMs: window.performance.now() - startedAt, audioSeconds: result.audioSeconds });
        if (result.ok) { onEnd?.(result.text); return; }
        onTiming?.({ stage: "asr-realtime-fallback", latencyMs: 0, reason: result.code });
        onResult?.("连接有点慢，正在重新识别这句话。");
      }
      let audio;
      const preparationStartedAt = window.performance.now();
      try {
        audio = await cropRecordedAudio(new Blob(recordedChunks, { type: recordedMimeType }),
          Math.max(0, speechStartOffsetMs - 800), window.OfflineAudioContext || window.webkitOfflineAudioContext);
      } catch {
        if (requestId === listeningRequestId) onError?.("这次录音没能正确读取，请再说一次。");
        return;
      }
      if (requestId !== listeningRequestId) return;
      onTiming?.({ stage: "audio-prepare", latencyMs: window.performance.now() - preparationStartedAt });
      const asrStartedAt = window.performance.now();
      transcriptionController = new AbortController();
      const result = await transcribeAudio(audio, transcriptionController.signal);
      if (requestId !== listeningRequestId) return;
      transcriptionController = null;
      onTiming?.({ stage: "asr", latencyMs: Math.round(window.performance.now() - asrStartedAt), serverLatencyMs: result.latencyMs });

      if (result.text) {
        onEnd?.(result.text);
        return;
      }

      onError?.(result.message || "已经听到声音，但当前环境还没有接通自动转文字。可以先用演示入口。");
    };

    const inputLabel = stream.getAudioTracks()[0]?.label || "";
    const meterReady = await startLevelMeter((level) => {
      if (requestId !== listeningRequestId) return;
      onLevel?.(level);
      const event = activity.update(level, window.performance.now());
      if (event.speechStarted) {
        speechDetected = true;
        realtime?.start();
        speechStartOffsetMs = window.performance.now() - captureStartedAt;
        onResult?.("听到了，请继续说。");
      }
      if (event.idle && recorder && recorder.state !== "inactive") {
        stopReason = "idle";
        recorder.stop();
      }
      if (event.shouldStop && recorder && recorder.state !== "inactive") {
        onTiming?.({ stage: "endpoint", latencyMs: event.silenceMs || 0 });
        stopReason = event.reason;
        recorder.stop();
      }
    }, stream);
    if (requestId !== listeningRequestId) return;
    if (!meterReady || finishRequested) {
      realtime?.cancel();
      cleanupRecorderOnly();
      if (finishRequested) onEnd?.("");
      else onError?.("没有启动声音检测，请再点一次小宇，并检查浏览器的麦克风设置。");
      return;
    }
    try { captureStartedAt = window.performance.now(); recorder.start(250); }
    catch {
      realtime?.cancel();
      cleanupRecorderOnly();
      onError?.("录音没有启动，请检查麦克风或换一个浏览器再试。");
      return;
    }
    onStart?.({ mode: "recording", inputLabel });
    onResult?.("正在听，说完就好。");
    stopTimer = window.setTimeout(() => {
      if (recorder && recorder.state !== "inactive") {
        stopReason = activity.hasSpeech() ? "max-speech" : "idle";
        recorder.stop();
      }
    }, 91000);
  }

  function cleanupRecorderOnly() {
    stopLevelMeter();
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
    if (stopTimer) window.clearTimeout(stopTimer);
    stopTimer = null;
  }

  async function startLevelMeter(onLevel, sourceStream = null) {
    stopLevelMeter();
    if (!onLevel) return false;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !navigator.mediaDevices?.getUserMedia) return false;

    const requestId = meterRequestId;
    try {
      const nextStream = sourceStream || (await navigator.mediaDevices.getUserMedia({ audio: true }));
      if (requestId !== meterRequestId || finishRequested) {
        if (!sourceStream) nextStream.getTracks().forEach((track) => track.stop());
        return;
      }

      meterStream = nextStream;
      meterOwnsStream = !sourceStream;
      meterContext = sharedAudioContext();
      if (!meterContext) throw new Error("Audio input unavailable");
      if (meterContext.state === "suspended") {
        let resumeTimer;
        try {
          await Promise.race([
            meterContext.resume(),
            new Promise((_, reject) => { resumeTimer = window.setTimeout(() => reject(new Error("Audio input suspended")), 3000); })
          ]);
        } finally { window.clearTimeout(resumeTimer); }
      }
      if (requestId !== meterRequestId) return false;
      if (meterContext.state !== "running") throw new Error("Audio input unavailable");
      const source = meterContext.createMediaStreamSource(nextStream);
      meterSource = source;
      const analyser = meterContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let smoothedLevel = 0;

      const updateLevel = () => {
        if (requestId !== meterRequestId || !meterContext) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          sum += sample * sample;
        }
        const level = Math.sqrt(sum / samples.length);
        smoothedLevel += (level - smoothedLevel) * 0.24;
        // Smooth the avatar, not the detector: smoothing can erase short/quiet syllables.
        onLevel(sourceStream ? level : smoothedLevel);
        meterFrame = window.requestAnimationFrame(updateLevel);
      };
      updateLevel();
      return true;
    } catch {
      // Speech recognition can still work when an independent level meter is unavailable.
      if (requestId === meterRequestId) stopLevelMeter();
      return false;
    }
  }

  function stopLevelMeter() {
    meterRequestId += 1;
    if (meterFrame) window.cancelAnimationFrame(meterFrame);
    meterFrame = null;
    if (meterOwnsStream && meterStream) meterStream.getTracks().forEach((track) => track.stop());
    meterStream = null;
    meterOwnsStream = false;
    // The shared context stays open for playback; only this meter's nodes are released.
    meterSource?.disconnect();
    meterSource = null;
    meterContext = null;
  }

  function pickMimeType() {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    return candidates.find((item) => MediaRecorder.isTypeSupported(item)) || "";
  }

  async function transcribeAudio(audio, signal) {
    try {
      const audioBase64 = await blobToBase64(audio);
      const response = await fetch("/api/transcribe", {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64,
          mimeType: audio.type || "audio/webm"
        })
      });
      const data = await response.json();
      if (!response.ok) {
        return { text: "", message: data.message };
      }
      return { text: data.text || "", message: data.message, latencyMs: Number(data.latencyMs || 0) };
    } catch {
      return { text: "", message: "录音成功，但本地转写接口没有连上。" };
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function speak(text, callbacks = {}) {
    if (!text) {
      callbacks.onEnd?.();
      return false;
    }
    const prepared = preparedSpeech?.text === text ? preparedSpeech : null;
    if (prepared) preparedSpeech = null;
    stopSpeaking();
    const requestId = speechRequestId;
    playSpeech(text, callbacks, requestId, prepared);
    return true;
  }

  // Speaks a reply that arrives sentence by sentence. Each sentence's speech is requested as soon as
  // the sentence arrives, while earlier ones are still playing, and all of them go onto one PCM
  // timeline, so there is no gap between sentences. Returns { push(text), end() }; callbacks are as
  // for speak(). If nothing could be streamed, the whole reply is spoken by the usual path once it
  // has ended (an un-tapped whole-file play may still be blocked on iOS, as before).
  function speakSentences(callbacks = {}) {
    stopSpeaking();
    const requestId = speechRequestId;
    const live = () => requestId === speechRequestId;
    const controller = new AbortController();
    speechFetchController = controller;
    const texts = [], requests = [];
    let ended = false, wake = null, fallback = false, startedAt = 0;
    const notify = () => { const resolve = wake; wake = null; resolve?.(); };
    const speakWhole = () => { if (live()) playSpeech(texts.join(""), callbacks, requestId, null); };
    const request = text => fetch("/api/speech/stream", { method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });

    void (async () => {
      if (playbackContext && playbackContext.state !== "running" && playbackContext.state !== "closed") {
        await Promise.race([playbackContext.resume().catch(() => {}), new Promise(resolve => window.setTimeout(resolve, 500))]);
      }
      if (!live()) return;
      if (playbackContext?.state !== "running") throw new Error("Playback context not running");
      let started = false;
      const player = createPcmPlayer(playbackContext, { destination: playbackOutput(),
        onStart: () => {
          if (!live()) return;
          started = true;
          callbacks.onTiming?.({ stage: "tts-cloud-stream", latencyMs: 0 });
          callbacks.onTiming?.({ stage: "tts-first-audio", latencyMs: Math.round(window.performance.now() - startedAt) });
          callbacks.onStart?.();
        },
        onEnd: () => { if (live()) { pcmPlayer = null; callbacks.onEnd?.(); } }
      });
      pcmPlayer = player;
      try {
        for (let index = 0; ; index++) {
          while (index >= requests.length && !ended) await new Promise(resolve => { wake = resolve; });
          if (!live()) return;
          if (index >= requests.length) break;
          const response = await requests[index];
          if (!live()) { await response.body?.cancel(); return; }
          if (!response.ok || !response.headers.get("content-type")?.includes("audio/pcm")) throw new Error("PCM stream unavailable");
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (!live()) { await reader.cancel(); return; }
              if (done) break;
              if (value?.length) player.push(value);
            }
          } finally { reader.releaseLock(); }
        }
        player.finish();
      } catch (error) {
        if (started || player.hasAudio()) throw Object.assign(error, { hadAudio: true });
        player.stop();
        throw error;
      }
    })().catch(error => {
      if (!live()) return;
      pcmPlayer = null;
      if (error.hadAudio) { callbacks.onError?.(); return; }
      callbacks.onTiming?.({ stage: "tts-stream-fallback", latencyMs: 0 });
      // Nothing was heard yet: speak the whole reply by the usual path once it is complete.
      fallback = true;
      if (ended) speakWhole();
    });

    return {
      push(text) {
        if (!live() || ended || !text) return;
        if (!startedAt) startedAt = window.performance.now();
        texts.push(text);
        if (fallback) return;
        const pending = request(text);
        pending.catch(() => {});
        requests.push(pending);
        notify();
      },
      end() {
        if (!live() || ended) return;
        ended = true;
        if (!texts.length) { callbacks.onEnd?.(); return; }
        if (fallback) speakWhole(); else notify();
      }
    };
  }

  function prefetchSpeech(text) {
    if (!text || text.length > 120 || window.location.protocol === "file:" || preparedSpeech?.text === text) return;
    preparedSpeech?.controller.abort();
    const controller = new AbortController();
    const prepared = { text, controller };
    prepared.promise = fetch("/api/speech", {
      method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text })
    }).then(async response => {
      if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) return null;
      const blob = await response.blob();
      return !controller.signal.aborted && blob.size > 0 && blob.size <= 512000 ? blob : null;
    }).catch(() => null);
    preparedSpeech = prepared;
  }

  async function playAudioBlob(blob, callbacks, requestId) {
    if (requestId !== speechRequestId) return;
    audioObjectUrl = window.URL.createObjectURL(blob);
    audioPlayer = new Audio(audioObjectUrl);
    audioPlayer.onplay = () => { if (requestId === speechRequestId) callbacks.onStart?.(); };
    audioPlayer.onended = () => {
      if (requestId !== speechRequestId) return;
      cleanupAudioPlayer(); callbacks.onEnd?.();
    };
    audioPlayer.onerror = () => {
      if (requestId !== speechRequestId) return;
      cleanupAudioPlayer(); callbacks.onError?.();
    };
    await audioPlayer.play();
  }

  async function playSpeech(text, callbacks, requestId, prepared) {
    if (window.location.protocol === "file:") {
      speakWithBrowser(text, callbacks, requestId);
      return;
    }

    if (prepared) {
      speechFetchController = prepared.controller;
      const waitStarted = window.performance.now();
      const blob = await prepared.promise;
      if (requestId !== speechRequestId) return;
      speechFetchController = null;
      if (blob) {
        callbacks.onTiming?.({ stage: "tts-prefetch-wait", latencyMs: Math.round(window.performance.now() - waitStarted) });
        try {
          callbacks.onTiming?.({ stage: "tts-cloud-mp3", latencyMs: 0 });
          await playAudioBlob(blob, callbacks, requestId);
          return;
        } catch {
          if (requestId !== speechRequestId) return;
          cleanupAudioPlayer();
          callbacks.onError?.();
          return;
        }
      }
    }

    // A context that was unlocked by a tap can drop out of "running" when the microphone opens or
    // closes on iOS. Resume it before choosing the path: the whole-file fallback below is also an
    // un-tapped play, which iOS may block (seen on an iPhone: first reply took 10 s).
    if (playbackContext && playbackContext.state !== "running" && playbackContext.state !== "closed") {
      const before = playbackContext.state;
      await Promise.race([playbackContext.resume().catch(() => {}), new Promise(resolve => window.setTimeout(resolve, 500))]);
      if (requestId !== speechRequestId) return;
      callbacks.onTiming?.({ stage: playbackContext.state === "running" ? "playback-resumed" : "playback-not-running",
        latencyMs: 0, reason: before === "interrupted" || before === "suspended" ? before : "other" });
    } else if (!playbackContext) {
      callbacks.onTiming?.({ stage: "playback-not-running", latencyMs: 0, reason: "no-context" });
    }

    if (playbackContext?.state === "running") {
      try {
        await playStreamedSpeech(text, callbacks, requestId);
        return;
      } catch (error) {
        if (requestId !== speechRequestId) return;
        const hadAudio = pcmPlayer?.hasAudio();
        pcmPlayer?.stop(); pcmPlayer = null;
        speechFetchController?.abort();
        if (hadAudio) { callbacks.onError?.(); return; }
        callbacks.onTiming?.({ stage: "tts-stream-fallback", latencyMs: 0 });
      }
    }

    speechFetchController = new AbortController();
    const startedAt = window.performance.now();
    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        signal: AbortSignal.any([speechFetchController.signal, AbortSignal.timeout(12000)]),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!response.ok) throw new Error("Cloud speech is unavailable");
      const audioBlob = await response.blob();
      if (requestId !== speechRequestId) return;
      callbacks.onTiming?.({
        stage: "tts",
        latencyMs: Math.round(window.performance.now() - startedAt),
        serverLatencyMs: Number(response.headers.get("X-Voice-Latency-Ms") || 0)
      });

      callbacks.onTiming?.({ stage: "tts-cloud-mp3", latencyMs: 0 });
      await playAudioBlob(audioBlob, callbacks, requestId);
    } catch (error) {
      if (requestId !== speechRequestId) return;
      cleanupAudioPlayer();
      callbacks.onTiming?.({ stage: "tts-cloud-failed", latencyMs: 0 });
      callbacks.onError?.();
    } finally {
      if (requestId === speechRequestId) speechFetchController = null;
    }
  }

  async function playStreamedSpeech(text, callbacks, requestId) {
    speechFetchController = new AbortController();
    const controller = speechFetchController;
    const startedAt = window.performance.now();
    const firstPacketTimer = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch("/api/speech/stream", {
        method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text })
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("audio/pcm")) throw new Error("PCM stream unavailable");
      if (requestId !== speechRequestId) { await response.body?.cancel(); return; }
      const player = createPcmPlayer(playbackContext, { destination: playbackOutput(),
        onStart: () => {
          if (requestId !== speechRequestId) return;
          callbacks.onTiming?.({ stage: "tts-cloud-stream", latencyMs: 0 });
          callbacks.onTiming?.({ stage: "tts-first-audio", latencyMs: Math.round(window.performance.now() - startedAt), serverLatencyMs: Number(response.headers.get("X-Voice-Latency-Ms") || 0) });
          callbacks.onStart?.();
        },
        onEnd: () => { if (requestId === speechRequestId) { pcmPlayer = null; callbacks.onEnd?.(); } }
      });
      pcmPlayer = player;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (requestId !== speechRequestId) { await reader.cancel(); return; }
          if (done) break;
          if (value?.length) { window.clearTimeout(firstPacketTimer); player.push(value); }
        }
        player.finish();
      } finally { reader.releaseLock(); }
    } finally {
      window.clearTimeout(firstPacketTimer);
      controller.abort();
      if (requestId === speechRequestId) speechFetchController = null;
    }
  }

  function speakWithBrowser(text, { onStart, onEnd, onError } = {}, requestId = speechRequestId) {
    if (!browserSpeechSupported || requestId !== speechRequestId) {
      if (requestId === speechRequestId) onError?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.88;
    utterance.pitch = 1.08;
    utterance.onstart = () => { if (requestId === speechRequestId) onStart?.(); };
    utterance.onend = () => { if (requestId === speechRequestId) onEnd?.(); };
    utterance.onerror = () => {
      if (requestId !== speechRequestId) return;
      onError?.();
    };
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    speechRequestId += 1;
    preparedSpeech?.controller.abort();
    preparedSpeech = null;
    pcmPlayer?.stop();
    pcmPlayer = null;
    if (speechFetchController) speechFetchController.abort();
    speechFetchController = null;
    cleanupAudioPlayer();
    if (browserSpeechSupported) window.speechSynthesis.cancel();
  }

  function cleanupAudioPlayer() {
    if (audioPlayer) {
      audioPlayer.onplay = null;
      audioPlayer.onended = null;
      audioPlayer.onerror = null;
      audioPlayer.pause();
      audioPlayer.src = "";
    }
    audioPlayer = null;
    if (audioObjectUrl) window.URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = "";
  }

  return {
    recognitionSupported,
    recordingSupported,
    speechSupported,
    preparePlayback,
    secureEnough,
    listen,
    finishListening,
    stopListening,
    speak,
    prefetchSpeech,
    stopSpeaking,
    speakSentences,
    watchForBargeIn
  };
}
