export const MICROPHONE_KEY = "xiaoyuji-microphone-device-v1";

export function getMicrophoneId() {
  try { return window.localStorage?.getItem(MICROPHONE_KEY) || ""; } catch { return ""; }
}

export function setMicrophoneId(id) {
  if (id) window.localStorage.setItem(MICROPHONE_KEY, id);
  else window.localStorage.removeItem(MICROPHONE_KEY);
}

// Speaking over Xiaoyu interrupts it unless a parent turned this off (e.g. too many false
// interruptions from a phone speaker). Device-local, like the microphone choice.
export const BARGE_IN_KEY = "xiaoyuji-barge-in-v1";

export function getBargeInEnabled() {
  try { return window.localStorage?.getItem(BARGE_IN_KEY) !== "off"; } catch { return true; }
}

export function setBargeInEnabled(enabled) {
  try { window.localStorage.setItem(BARGE_IN_KEY, enabled ? "on" : "off"); } catch { /* keep the in-page choice */ }
}

// Realtime recognition streams audio while the child speaks (faster). A parent can turn it off to
// recognise after speaking instead, e.g. when a device makes noise during realtime capture.
export const REALTIME_KEY = "xiaoyuji-realtime-asr-v1";

export function getRealtimeEnabled() {
  try { return window.localStorage?.getItem(REALTIME_KEY) !== "off"; } catch { return true; }
}

export function setRealtimeEnabled(enabled) {
  try { window.localStorage.setItem(REALTIME_KEY, enabled ? "on" : "off"); } catch { /* keep the in-page choice */ }
}

// voiceProcessing: false opens the microphone without echo cancellation, noise suppression or
// gain control. Used only to listen for barge-in while Xiaoyu speaks: on an iPhone, recording with
// echo cancellation during playback switches to call audio (muffled, with an electric noise).
export async function openMicrophone({ voiceProcessing = true } = {}) {
  const id = getMicrophoneId();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: {
    echoCancellation: voiceProcessing, noiseSuppression: voiceProcessing, autoGainControl: voiceProcessing, channelCount: 1,
    ...(id ? { deviceId: { exact: id } } : {})
  } });
  const track = stream.getAudioTracks()[0];
  const actual = track?.getSettings?.().deviceId;
  if (id && actual && actual !== id) {
    stream.getTracks().forEach(item => item.stop());
    throw new DOMException("Selected microphone was not used", "OverconstrainedError");
  }
  return stream;
}

// Whether the microphone in use is a headset's (AirPods and other Bluetooth or wired headsets), from
// the track label the browser reports once permission is granted. Only this yes/no is kept.
const HEADSET = /airpods|bluetooth|蓝牙|耳机|headset|headphone|earpods|beats|buds|hands-?free|免提/i;
export function isHeadsetInput(stream) {
  return inputKind(stream) === 2;
}

// What kind of microphone a stream comes from, as a number for the pilot log (never the label,
// which can contain a person's name): 0 no label, 1 the device's own, 2 a headset, 3 other.
// On an iPhone with AirPods the label did not say so (pilot, 2026-11-02), hence also inputCount.
const BUILT_IN = /iphone|ipad|built-?in|内置|麦克风$|microphone$/i;
export function inputKind(stream) {
  const label = String(stream?.getAudioTracks?.()[0]?.label || "");
  if (!label) return 0;
  if (HEADSET.test(label)) return 2;
  if (BUILT_IN.test(label)) return 1;
  return 3;
}

// How many microphones the browser offers; a connected headset usually adds one.
export async function inputCount() {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audioinput").length; }
  catch { return 0; }
}

export function microphoneError(error) {
  if (["NotFoundError", "OverconstrainedError"].includes(error?.name)) return "找不到所选麦克风，请在家庭设置中重新选择。";
  if (["NotAllowedError", "SecurityError"].includes(error?.name)) return "麦克风未获允许，请检查浏览器或系统的麦克风权限。";
  if (error?.name === "NotReadableError") return "麦克风暂时无法使用，请检查设备连接或关闭占用它的应用。";
  return "录音未能启动，请检查麦克风后重试。";
}
