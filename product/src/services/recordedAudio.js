// Decode a complete container before cropping: encoded chunks are not standalone audio.
export async function cropRecordedAudio(blob, startMs, AudioContextClass) {
  if (!AudioContextClass) throw new Error("Audio decoding unavailable");
  const context = new AudioContextClass(1, 1, 48000);
  const audio = await context.decodeAudioData(await blob.arrayBuffer());
  const start = Math.max(0, Math.min(audio.length - 1, Math.floor(startMs * audio.sampleRate / 1000)));
  const count = audio.length - start;
  if (count <= 0) throw new Error("Empty recording");
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const ascii = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, "WAVE"); ascii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, count * 2, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
  for (let i = 0; i < count; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[start + i], 0) / channels.length));
    view.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}
