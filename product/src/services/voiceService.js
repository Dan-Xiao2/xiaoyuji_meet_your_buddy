import { createVoiceActivityDetector } from "./voiceActivity.js";
import { createPcmPlayer } from "./pcmPlayer.js";
import { cropRecordedAudio } from "./recordedAudio.js";
import { createRealtimeCapture } from "./realtimeAsr.js";
import { getMicrophoneId, openMicrophone, microphoneError } from "./microphoneInput.js";

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

  function preparePlayback() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      playbackContext ||= new AudioContextClass();
      if (playbackContext.state === "suspended") playbackContext.resume().catch(() => {});
    } catch { /* Whole-response cloud audio remains available. */ }
  }

  function listen({ onStart, onResult, onError, onEnd, onIdle, onLevel, onTiming, onProcessing, preferRecorder = false, preferRealtime = false }) {
    stopListening();
    finishRequested = false;
    const requestId = listeningRequestId;

    if (getMicrophoneId() && !preferRecorder && recognitionSupported) {
      onError?.("所选麦克风需要云端语音识别。请检查语音服务，或在家庭设置中选择跟随系统。");
      return;
    }

    if (preferRecorder && recordingSupported) {
      listenWithRecorder({ onStart, onResult, onError, onEnd, onIdle, onLevel, onTiming, onProcessing, preferRealtime }, requestId);
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

  async function listenWithRecorder({ onStart, onResult, onError, onEnd, onIdle, onLevel, onTiming, onProcessing, preferRealtime = false }, requestId) {
    if (!secureEnough) {
      onError?.("浏览器要求在 localhost 或 HTTPS 页面里使用麦克风。请用本地预览地址打开。");
      return;
    }

    if (!recordingSupported) {
      onError?.("当前浏览器不能打开麦克风。明天演示可以先点下方三个大入口。");
      return;
    }

    try {
      const nextStream = await openMicrophone();
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
    const activity = createVoiceActivityDetector();
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
        realtime = await createRealtimeCapture(stream, { onTiming });
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
      meterContext = new AudioContextClass();
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
    if (meterContext && meterContext.state !== "closed") meterContext.close().catch(() => {});
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
      const player = createPcmPlayer(playbackContext, {
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
    stopSpeaking
  };
}
