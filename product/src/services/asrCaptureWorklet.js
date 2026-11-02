// Runs in the page's native-rate AudioContext and converts the microphone to the 16 kHz mono PCM16
// the recogniser needs. The context used to be created at 16 kHz; on an iPhone (48 kHz hardware) a
// running context at another rate gave crackling "electric" noise while the child spoke.
const TARGET_RATE = 16000;

class AsrCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1600); // 100 ms at 16 kHz
    this.length = 0;
    this.stopped = false;
    // Box-filter decimation: average the input samples that fall into each 16 kHz output sample.
    // Crude, but it removes most aliasing above 8 kHz and is plenty for speech recognition.
    this.step = sampleRate / TARGET_RATE;
    this.phase = 0; this.sum = 0; this.count = 0;
    this.port.onmessage = () => {
      this.flush();
      this.stopped = true;
      this.port.postMessage({ type: "flushed" });
    };
  }
  flush() {
    if (!this.length) return;
    const buffer = new ArrayBuffer(this.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < this.length; i++) {
      const value = Math.max(-1, Math.min(1, this.samples[i]));
      view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    this.port.postMessage(buffer, [buffer]);
    this.length = 0;
  }
  emit(value) {
    this.samples[this.length++] = value;
    if (this.length === this.samples.length) this.flush();
  }
  process(inputs) {
    if (this.stopped) return false;
    for (const sample of inputs[0]?.[0] || []) {
      if (this.step <= 1) { this.emit(sample); continue; }
      this.sum += sample; this.count++; this.phase += 1;
      if (this.phase >= this.step) {
        this.emit(this.sum / this.count);
        this.phase -= this.step; this.sum = 0; this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor("asr-capture", AsrCapture);
