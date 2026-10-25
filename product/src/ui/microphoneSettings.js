import { getMicrophoneId, setMicrophoneId, openMicrophone, microphoneError } from "../services/microphoneInput.js";

export function mountMicrophoneSettings({ beforeCapture }) {
  const root = document.querySelector("#microphoneSettings");
  const select = root.querySelector("select");
  const status = root.querySelector("[data-mic-status]");
  const actual = root.querySelector("[data-mic-actual]");
  const recent = root.querySelector("[data-mic-recent]");
  const player = root.querySelector("audio");
  const meter = root.querySelector("meter");
  const refresh = root.querySelector("[data-mic-refresh]");
  const record = root.querySelector("[data-mic-record]");
  const stop = root.querySelector("[data-mic-stop]");
  const clear = root.querySelector("[data-mic-clear]");
  let generation = 0, stream, recorder, context, timer, frame, objectUrl = "", busy = false;
  let listRevision = 0;

  function controls(value) {
    busy = value;
    select.disabled = refresh.disabled = record.disabled = value;
    stop.hidden = !value;
    clear.hidden = !objectUrl;
  }

  function release() {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream = null;
    context?.close().catch(() => {});
    context = null;
    meter.value = 0;
  }

  function reset() {
    generation++;
    if (recorder?.state === "recording") recorder.stop();
    recorder = null;
    release();
    player.pause();
    player.removeAttribute("src");
    player.load();
    player.hidden = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
    actual.textContent = "";
    controls(false);
    status.textContent = "";
  }

  async function listDevices() {
    const revision = ++listRevision;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === "audioinput" && item.deviceId);
      if (revision !== listRevision) return;
      const selected = getMicrophoneId();
      select.replaceChildren(new Option("跟随系统", ""));
      for (const [index, device] of devices.entries()) {
        if (device.deviceId === "default" || device.deviceId === "communications") continue;
        select.add(new Option(device.label || `麦克风 ${index + 1}`, device.deviceId));
      }
      if (selected && !Array.from(select.options).some(option => option.value === selected)) {
        select.add(new Option("之前选择的麦克风（暂不可用）", selected));
      }
      select.value = selected;
    } catch {
      if (revision === listRevision) status.textContent = "暂时无法读取设备，请重试。";
    }
  }

  async function capture(testRecording) {
    if (busy) return;
    beforeCapture();
    reset();
    const request = generation;
    controls(true);
    status.textContent = "等待麦克风许可…";
    try {
      if (!navigator.mediaDevices?.getUserMedia || (testRecording && !window.MediaRecorder)) throw new Error("unsupported");
      const next = await openMicrophone();
      if (request !== generation) { next.getTracks().forEach(track => track.stop()); return; }
      stream = next;
      actual.textContent = `实际输入：${stream.getAudioTracks()[0]?.label || "浏览器未提供设备名称"}`;
      await listDevices();
      if (request !== generation) return;
      if (!testRecording) {
        release(); controls(false); status.textContent = "已读取，可选择麦克风。"; return;
      }
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = event => { if (request === generation && event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        if (request !== generation) return;
        const type = recorder.mimeType;
        recorder = null;
        release();
        if (chunks.length) {
          objectUrl = URL.createObjectURL(new Blob(chunks, { type }));
          player.src = objectUrl; player.hidden = false;
          status.textContent = "录音完成。";
        } else status.textContent = "没有录到声音，请重试。";
        controls(false);
      };
      recorder.onerror = () => { if (request === generation) { reset(); status.textContent = "录音中断，请重试。"; } };
      stream.getAudioTracks()[0].onended = () => { if (request === generation) { reset(); status.textContent = "麦克风已断开，请重新选择。"; } };
      // The meter is optional; local playback is the source of truth for capture quality.
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        try {
          context = new AudioContextClass();
          void context.resume().catch(() => {});
          const analyser = context.createAnalyser(); analyser.fftSize = 2048;
          context.createMediaStreamSource(stream).connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          const tick = () => {
            if (request !== generation || !stream) return;
            analyser.getFloatTimeDomainData(samples);
            meter.value = Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) * 5);
            frame = requestAnimationFrame(tick);
          };
          tick();
        } catch { context?.close().catch(() => {}); context = null; }
      }
      recorder.start();
      status.textContent = "正在录音，8 秒后自动停止。";
      timer = setTimeout(() => { if (request === generation) finish(); }, 8000);
    } catch (error) {
      if (request !== generation) return;
      reset(); status.textContent = microphoneError(error);
    }
  }

  function finish() {
    if (recorder?.state === "recording") {
      recorder.stop(); release(); status.textContent = "正在准备试听…";
    } else reset();
  }

  refresh.addEventListener("click", () => capture(false));
  record.addEventListener("click", () => capture(true));
  stop.addEventListener("click", finish);
  clear.addEventListener("click", reset);
  player.addEventListener("error", () => { if (objectUrl) status.textContent = "录音无法播放，请重新录一小段。"; });
  select.addEventListener("change", () => {
    reset();
    try { setMicrophoneId(select.value); status.textContent = "已保存麦克风选择。"; }
    catch { status.textContent = "选择未保存，浏览器存储不可用。"; void listDevices(); }
  });
  root.addEventListener("toggle", () => { if (root.open) void listDevices(); else reset(); });
  navigator.mediaDevices?.addEventListener?.("devicechange", () => {
    if (root.open) void listDevices();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
  window.addEventListener("pagehide", reset);
  return {
    reset,
    noteConversationInput(label) {
      recent.textContent = label ? `上次聊天输入：${label}` : "上次聊天使用浏览器自动听写，无法确认麦克风。";
    }
  };
}
