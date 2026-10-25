class AsrCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1600);
    this.length = 0;
    this.stopped = false;
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
  process(inputs) {
    if (this.stopped) return false;
    for (const sample of inputs[0]?.[0] || []) {
      this.samples[this.length++] = sample;
      if (this.length === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor("asr-capture", AsrCapture);
