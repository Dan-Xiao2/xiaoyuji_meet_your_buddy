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

export async function openMicrophone() {
  const id = getMicrophoneId();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
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

export function microphoneError(error) {
  if (["NotFoundError", "OverconstrainedError"].includes(error?.name)) return "找不到所选麦克风，请在家庭设置中重新选择。";
  if (["NotAllowedError", "SecurityError"].includes(error?.name)) return "麦克风未获允许，请检查浏览器或系统的麦克风权限。";
  if (error?.name === "NotReadableError") return "麦克风暂时无法使用，请检查设备连接或关闭占用它的应用。";
  return "录音未能启动，请检查麦克风后重试。";
}
