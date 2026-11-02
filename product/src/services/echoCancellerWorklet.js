// In-page echo canceller for voice barge-in. The barge-in microphone runs without the system's
// echo cancellation (on an iPhone that switches to call audio: muffled speech, electric noise), so
// Xiaoyu's own voice leaks into it at about the child's level (pilot, 2026-11-02). Input 0 is the
// raw microphone, input 1 is what Xiaoyu is playing (the page's output bus, same clock). The
// canceller predicts the leak from the playback and subtracts it; the barge-in detector then
// listens to what is left. Only levels leave this worklet, never audio.
//
// At 8 kHz (enough to tell that someone is speaking), in 16 ms blocks. The speaker-to-microphone
// delay is found from 2 ms energy envelopes; after it, a partitioned frequency-domain adaptive
// filter (MDF, as in Speex) models 192 ms of echo. A time-domain NLMS filter was tried first and
// converged far too slowly on speech (about 12 dB after 10 s even for a pure delay); normalising
// each frequency bin on its own fixes that. Two filters, as in Speex: the background one always
// adapts, the foreground one does the cancelling and only takes the background's weights when they
// cancel better, so the child speaking (which throws the background filter off) does no harm.
export const RATE = 8000;
export const BLOCK = 128;       // samples per block (16 ms)
const SIZE = BLOCK * 2;         // FFT size (overlap-save)
const PARTS = 12;               // 12 × 16 ms = 192 ms of echo path after the bulk delay
const LEAD = 3 * BLOCK;         // the filter starts 48 ms before the estimated delay
const HISTORY = 8192;           // playback samples kept (1 s)
const FRAME = 16;               // 2 ms envelope frames for the delay estimate
const MAX_LAG = 160;            // speaker-to-microphone delays up to 320 ms
const WINDOW = 500;             // the delay is estimated over the last second
const ENVELOPES = 1024;         // envelope frames kept (> WINDOW + MAX_LAG)
const ESTIMATE_EVERY = 50;      // frames (100 ms)
const COMPARE_BLOCKS = 4;       // the two filters are compared over 64 ms
const MU = 1;                   // fastest of 0.5 / 1 / 1.5 in the simulation
const ACTIVE = 1e-6;            // playback mean square above this (RMS ~0.001) counts as playing

class Fft {
  constructor(size) {
    this.size = size;
    this.cos = new Float32Array(size / 2); this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / size); this.sin[i] = Math.sin(2 * Math.PI * i / size); }
    this.reverse = new Uint16Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.reverse[i] = r; }
  }
  // In place. The inverse includes the 1/size scaling.
  transform(re, im, inverse = false) {
    const n = this.size, reverse = this.reverse;
    for (let i = 0; i < n; i++) {
      const j = reverse[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    const sign = inverse ? 1 : -1;
    for (let length = 2; length <= n; length *= 2) {
      const half = length / 2, step = n / length;
      for (let start = 0; start < n; start += length) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step], wi = sign * this.sin[k * step];
          const a = start + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

const spectra = () => Array.from({ length: PARTS }, () => ({ re: new Float32Array(SIZE), im: new Float32Array(SIZE) }));

export class EchoCanceller {
  constructor({ weights = null, delay = 0, offset = null } = {}) {
    this.fft = new Fft(SIZE);
    this.history = new Float32Array(HISTORY * 2); // each sample twice, so a window is contiguous
    this.at = 0;
    this.front = spectra(); this.back = spectra(); this.input = spectra();
    if (weights && weights.length === PARTS * SIZE * 2) {
      for (let p = 0; p < PARTS; p++) for (let k = 0; k < SIZE; k++) {
        this.front[p].re[k] = this.back[p].re[k] = weights[(p * SIZE + k) * 2];
        this.front[p].im[k] = this.back[p].im[k] = weights[(p * SIZE + k) * 2 + 1];
      }
    }
    this.delay = Math.max(0, Math.min(MAX_LAG * FRAME, Math.round(Number(delay) || 0)));
    // Saved weights belong to the offset they were learnt at (it moves in whole blocks).
    const saved = weights && Number.isInteger(offset) && offset >= 0 && offset <= MAX_LAG * FRAME;
    this.offset = saved ? offset : Math.max(0, this.delay - LEAD);
    this.binPower = new Float32Array(SIZE);
    this.re = new Float32Array(SIZE); this.im = new Float32Array(SIZE);
    this.errRe = new Float32Array(SIZE); this.errIm = new Float32Array(SIZE);
    this.residual = new Float32Array(BLOCK); this.trial = new Float32Array(BLOCK);
    this.compared = { front: 0, back: 0, mic: 0, count: 0 }; this.worse = 0;
    this.totals = { mic: 0, residual: 0 };
    this.micEnvelope = new Float32Array(ENVELOPES); this.refEnvelope = new Float32Array(ENVELOPES);
    this.frames = 0; this.frame = { mic: 0, ref: 0, count: 0 };
    this.candidate = -1;
  }

  // SIZE playback samples ending `back` samples before the newest one, as a spectrum.
  spectrumOf(target, back) {
    const end = this.at - 1 + HISTORY - back; // index of that last sample in the doubled buffer
    for (let i = 0; i < SIZE; i++) { target.re[i] = this.history[end - SIZE + 1 + i]; target.im[i] = 0; }
    this.fft.transform(target.re, target.im);
  }

  // Microphone minus the echo `filter` predicts, for the current block (written into `out`).
  cancel(filter, mic, out) {
    const re = this.re, im = this.im;
    re.fill(0); im.fill(0);
    for (let p = 0; p < PARTS; p++) {
      const w = filter[p], x = this.input[p];
      for (let k = 0; k < SIZE; k++) {
        re[k] += w.re[k] * x.re[k] - w.im[k] * x.im[k];
        im[k] += w.re[k] * x.im[k] + w.im[k] * x.re[k];
      }
    }
    this.fft.transform(re, im, true);
    let energy = 0;
    for (let i = 0; i < BLOCK; i++) { out[i] = mic[i] - re[BLOCK + i]; energy += out[i] * out[i]; }
    return energy;
  }

  // One block of BLOCK samples at 8 kHz: microphone and playback in, the microphone without the
  // predicted echo out.
  processBlock(mic, ref) {
    for (let i = 0; i < BLOCK; i++) {
      this.history[this.at] = ref[i]; this.history[this.at + HISTORY] = ref[i];
      this.at = (this.at + 1) % HISTORY;
      this.envelope(mic[i], ref[i]);
    }
    // The newest partition is the delayed playback block (with the block before it, overlap-save).
    this.input.unshift(this.input.pop());
    this.spectrumOf(this.input[0], this.offset);
    let refPower = 0;
    const newest = this.input[0];
    for (let k = 0; k < SIZE; k++) {
      const power = newest.re[k] * newest.re[k] + newest.im[k] * newest.im[k];
      this.binPower[k] = 0.9 * this.binPower[k] + 0.1 * power;
    }
    for (let i = this.at - BLOCK + HISTORY - this.offset, n = 0; n < BLOCK; n++, i++) refPower += this.history[i] ** 2;
    const active = refPower / BLOCK > ACTIVE;

    let micEnergy = 0;
    for (let i = 0; i < BLOCK; i++) micEnergy += mic[i] * mic[i];
    const frontEnergy = this.cancel(this.front, mic, this.residual);
    const backEnergy = this.cancel(this.back, mic, this.trial);
    if (active) { this.adapt(); this.totals.mic += micEnergy; this.totals.residual += frontEnergy; }
    this.compare(micEnergy, frontEnergy, backEnergy, active);
    return this.residual;
  }

  // Background filter update: per-bin normalised gradient, constrained to BLOCK taps per partition.
  adapt() {
    const errRe = this.errRe, errIm = this.errIm, re = this.re, im = this.im;
    errRe.fill(0); errIm.fill(0);
    for (let i = 0; i < BLOCK; i++) errRe[BLOCK + i] = this.trial[i];
    this.fft.transform(errRe, errIm);
    const floor = SIZE * ACTIVE;
    for (let p = 0; p < PARTS; p++) {
      const x = this.input[p], w = this.back[p];
      for (let k = 0; k < SIZE; k++) {
        const scale = MU / (PARTS * this.binPower[k] + floor);
        re[k] = (x.re[k] * errRe[k] + x.im[k] * errIm[k]) * scale; // conj(X) · E
        im[k] = (x.re[k] * errIm[k] - x.im[k] * errRe[k]) * scale;
      }
      this.fft.transform(re, im, true);
      for (let i = BLOCK; i < SIZE; i++) { re[i] = 0; im[i] = 0; }
      for (let i = 0; i < BLOCK; i++) im[i] = 0;
      this.fft.transform(re, im);
      for (let k = 0; k < SIZE; k++) { w.re[k] += re[k]; w.im[k] += im[k]; }
    }
  }

  compare(mic, front, back, active) {
    if (!active) return;
    const c = this.compared;
    c.mic += mic; c.front += front; c.back += back;
    if (++c.count < COMPARE_BLOCKS) return;
    if (c.back < 0.7 * c.front && c.back < c.mic) { this.copy(this.back, this.front); this.worse = 0; }
    else if (c.back > 4 * c.front) { if (++this.worse >= 2) { this.copy(this.front, this.back); this.worse = 0; } }
    else this.worse = 0;
    // A foreground filter that adds echo instead of removing it (the path changed) is dropped.
    if (c.front > 2 * c.mic) for (const w of this.front) { w.re.fill(0); w.im.fill(0); }
    c.mic = 0; c.front = 0; c.back = 0; c.count = 0;
  }

  copy(from, to) { for (let p = 0; p < PARTS; p++) { to[p].re.set(from[p].re); to[p].im.set(from[p].im); } }

  envelope(mic, ref) {
    const frame = this.frame;
    frame.mic += mic * mic; frame.ref += ref * ref;
    if (++frame.count < FRAME) return;
    const index = this.frames % ENVELOPES;
    this.micEnvelope[index] = Math.sqrt(frame.mic / FRAME);
    this.refEnvelope[index] = Math.sqrt(frame.ref / FRAME);
    frame.mic = 0; frame.ref = 0; frame.count = 0;
    this.frames++;
    if (this.frames >= WINDOW + MAX_LAG && this.frames % ESTIMATE_EVERY === 0) this.estimateDelay();
  }

  // Correlates the microphone envelope with the playback envelope at each lag. A new delay is
  // taken only when two estimates in a row agree, so one noisy window does not move the filter.
  estimateDelay() {
    const mic = this.micEnvelope, ref = this.refEnvelope, last = this.frames - 1;
    const at = (frame) => ((frame % ENVELOPES) + ENVELOPES) % ENVELOPES;
    let playing = 0, micMean = 0;
    for (let t = 0; t < WINDOW; t++) { micMean += mic[at(last - t)]; if (ref[at(last - t)] > 0.001) playing++; }
    if (playing < WINDOW * 0.3) return;
    micMean /= WINDOW;
    let micVar = 0;
    for (let t = 0; t < WINDOW; t++) { const value = mic[at(last - t)] - micMean; micVar += value * value; }
    let best = -1, bestScore = 0.4;
    for (let lag = 0; lag <= MAX_LAG; lag++) {
      let refMean = 0;
      for (let t = 0; t < WINDOW; t++) refMean += ref[at(last - t - lag)];
      refMean /= WINDOW;
      let cross = 0, refVar = 0;
      for (let t = 0; t < WINDOW; t++) {
        const value = ref[at(last - t - lag)] - refMean;
        cross += (mic[at(last - t)] - micMean) * value; refVar += value * value;
      }
      const score = micVar > 0 && refVar > 0 ? cross / Math.sqrt(micVar * refVar) : 0;
      if (score > bestScore) { bestScore = score; best = lag; }
    }
    if (best < 0) { this.candidate = -1; return; }
    const agreed = this.candidate >= 0 && Math.abs(best - this.candidate) <= 2;
    this.candidate = best;
    if (agreed) this.setDelay(best * FRAME);
  }

  // Moves the filter by whole blocks, keeping what was learnt at its new position. With room echo
  // the estimate wanders by ±20 ms (simulation), and every move cost the filter most of what it
  // had learnt, so it only moves when the direct path is outside the filter or far from its start.
  setDelay(delay) {
    this.delay = delay;
    const target = Math.max(0, delay - LEAD);
    if (delay >= this.offset && Math.abs(target - this.offset) <= 2 * BLOCK) return;
    const shift = Math.round((target - this.offset) / BLOCK);
    if (!shift) return;
    for (const filter of [this.front, this.back]) {
      const moved = filter.map((_, p) => filter[p + shift] || null);
      for (let p = 0; p < PARTS; p++) {
        if (moved[p]) { filter[p] = moved[p]; continue; }
        filter[p] = { re: new Float32Array(SIZE), im: new Float32Array(SIZE) };
      }
    }
    this.offset += shift * BLOCK;
    for (let p = 0; p < PARTS; p++) this.spectrumOf(this.input[p], this.offset + p * BLOCK);
  }

  // How much of the microphone's energy was removed while Xiaoyu played, in dB.
  reduction() {
    return this.totals.residual > 0 ? 10 * Math.log10(this.totals.mic / this.totals.residual) : 0;
  }

  // Kept by the page between replies: the echo path stays about the same, so the next reply does
  // not start from nothing.
  state() {
    const weights = new Float32Array(PARTS * SIZE * 2);
    for (let p = 0; p < PARTS; p++) for (let k = 0; k < SIZE; k++) {
      weights[(p * SIZE + k) * 2] = this.front[p].re[k]; weights[(p * SIZE + k) * 2 + 1] = this.front[p].im[k];
    }
    return { weights, delay: this.delay, offset: this.offset };
  }
}

if (typeof registerProcessor === "function") {
  class EchoCancellerProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.canceller = new EchoCanceller(options?.processorOptions || {});
      this.step = sampleRate / RATE; // eslint-disable-line no-undef
      this.phase = 0; this.mic = 0; this.ref = 0; this.count = 0;
      this.micBlock = new Float32Array(BLOCK); this.refBlock = new Float32Array(BLOCK); this.filled = 0;
      this.stopped = false;
      this.port.onmessage = () => {
        this.stopped = true;
        this.port.postMessage({ type: "state", ...this.canceller.state(), reduction: this.canceller.reduction() });
      };
    }
    process(inputs) {
      if (this.stopped) return false;
      const mic = inputs[0]?.[0], ref = inputs[1]?.[0];
      if (!mic) return true;
      for (let i = 0; i < mic.length; i++) {
        // Box-filter decimation, the same on both inputs, so the echo path stays linear.
        this.mic += mic[i]; this.ref += ref ? ref[i] : 0; this.count++; this.phase += 1;
        if (this.phase < this.step) continue;
        this.micBlock[this.filled] = this.mic / this.count; this.refBlock[this.filled] = this.ref / this.count;
        this.phase -= this.step; this.mic = 0; this.ref = 0; this.count = 0;
        if (++this.filled < BLOCK) continue;
        this.filled = 0;
        const residual = this.canceller.processBlock(this.micBlock, this.refBlock);
        const rms = (block) => { let sum = 0; for (const value of block) sum += value * value; return Math.sqrt(sum / block.length); };
        // A level every 16 ms; the delay is reported so a pilot session shows what was found.
        this.port.postMessage({ type: "level", mic: rms(this.micBlock), residual: rms(residual), reference: rms(this.refBlock),
          delayMs: this.canceller.delay / (RATE / 1000) });
      }
      return true;
    }
  }
  registerProcessor("echo-canceller", EchoCancellerProcessor);
}
