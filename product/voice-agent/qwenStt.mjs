import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { stt } from '@livekit/agents';
import { realtimeAsrConfig } from '../server/realtimeAsr.mjs';

// The ASR handshake may take seconds. Audio that arrives meanwhile is kept in order and
// sent exactly once after the provider acknowledges the session. Ten seconds is far above
// the handshake timeout, so hitting this cap means something is wrong rather than slow.
const MAX_QUEUED_SAMPLES = 16000 * 10;

// Continuous ASR connection. Provider endpointing supplies final transcripts;
// local AgentSession VAD independently controls interruption.
//
// onInputReady fires once per stream, after the first audio frame has actually been
// appended to the provider. A handshake acknowledgement alone is not proof that audio
// reaches the recogniser. onAppend fires after every appended frame, so a caller can prove
// that audio is still arriving at a later point (for example after a client reconnects).
// onDiagnostics receives timing records with counts only: never audio, transcript text, or identities.
export class QwenSTT extends stt.STT {
  label = 'xiaoyu.QwenSTT';
  constructor({ config = realtimeAsrConfig(), connect = (url, options) => new WebSocket(url, options),
    onInputReady = () => {}, onAppend = () => {}, onDiagnostics = () => {} } = {}) {
    super({ streaming: true, interimResults: false });
    if (!config.enabled) throw new Error('Qwen ASR is not configured');
    this.config = config;
    this.connect = connect;
    this.onInputReady = onInputReady;
    this.onAppend = onAppend;
    this.onDiagnostics = onDiagnostics;
  }
  async _recognize() { throw new Error('Use the continuous ASR stream'); }
  stream(options = {}) { return new QwenSpeechStream(this, options.connOptions); }
}

class QwenSpeechStream extends stt.SpeechStream {
  label = 'xiaoyu.QwenSpeechStream';
  constructor(provider, options) {
    super(provider, 16000, options);
    this.provider = provider;
  }
  async run() {
    const { config, connect, onInputReady, onAppend, onDiagnostics } = this.provider;
    const startedAt = performance.now();
    // Diagnostics must never be able to disturb the audio path.
    const diagnose = (stage, data = {}) => {
      try { onDiagnostics({ stage, elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10, ...data }); } catch { /* ignore */ }
    };
    const socket = connect(config.endpoint, { headers: { Authorization: `Bearer ${config.key}`, 'OpenAI-Beta': 'realtime=v1' }, handshakeTimeout: 5000, maxPayload: 65536 });
    const send = (type, body = {}) => socket.send(JSON.stringify({ event_id: randomUUID(), type, ...body }));
    const queued = [];
    let ready = false, appended = false, receivedFirst = false;
    let queuedSamples = 0, sentSamples = 0;
    let rejectConnection;
    // A rejected connection must also stop input when no microphone frame arrives.
    const failure = new Promise((_, reject) => { rejectConnection = reject; });
    failure.catch(() => {});
    const fail = () => rejectConnection(new Error('ASR connection failed'));
    const aborted = new Promise(resolve => { this.abortSignal.addEventListener('abort', resolve, { once: true }); });
    const cancel = () => { queued.length = 0; socket.terminate(); };
    const timer = setTimeout(fail, 6000);
    this.abortSignal.addEventListener('abort', cancel, { once: true });

    const sendFrame = frame => {
      if (socket.bufferedAmount > 128000) throw new Error('ASR backpressure limit');
      const bytes = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      send('input_audio_buffer.append', { audio: bytes.toString('base64') });
      sentSamples += frame.samplesPerChannel;
      try { onAppend(); } catch { /* readiness reporting must not break audio */ }
      if (appended) return;
      appended = true;
      diagnose('asr-first-append', { sentSamples: frame.samplesPerChannel });
      try { onInputReady(); } catch { /* readiness reporting must not break audio */ }
    };
    // Synchronous, so frames that arrive later cannot overtake the queued ones.
    const flush = () => { while (queued.length) sendFrame(queued.shift()); };

    socket.on('error', fail);
    socket.on('close', () => { if (!this.abortSignal.aborted) fail(); });
    socket.on('open', () => send('session.update', { session: {
      modalities: ['text'], input_audio_format: 'pcm', sample_rate: 16000,
      input_audio_transcription: { language: config.language },
      turn_detection: { type: 'server_vad', threshold: 0.2, silence_duration_ms: 650 }
    } }));
    socket.on('message', raw => {
      if (this.abortSignal.aborted) return;
      try {
        const event = JSON.parse(String(raw));
        if (event.type === 'session.updated') {
          ready = true; clearTimeout(timer);
          diagnose('asr-session-updated', { queuedSamples });
          flush();
        }
        // appendedSamples is the audio position the provider had received at that moment, so
        // it can be compared with where speech truly starts in a known sample.
        if (event.type === 'input_audio_buffer.speech_started') {
          // audio_start_ms is where the provider itself says speech began, if it reports it.
          diagnose('asr-speech-started', { appendedSamples: sentSamples,
            ...(Number.isFinite(event.audio_start_ms) ? { serverAudioStartMs: event.audio_start_ms } : {}) });
          this.queue.put({ type: stt.SpeechEventType.START_OF_SPEECH });
        }
        if (event.type === 'conversation.item.input_audio_transcription.completed') {
          const text = String(event.transcript || '').trim().slice(0, 4000);
          if (text) {
            diagnose('asr-transcript', { appendedSamples: sentSamples, characters: text.length });
            this.queue.put({ type: stt.SpeechEventType.FINAL_TRANSCRIPT,
              alternatives: [{ text, language: config.language, startTime: 0, endTime: 0, confidence: 0 }], requestId: event.item_id });
            this.queue.put({ type: stt.SpeechEventType.END_OF_SPEECH });
          }
        }
        if (['error', 'conversation.item.input_audio_transcription.failed', 'session.finished'].includes(event.type)) fail();
      } catch { fail(); }
    });
    // Consume input from the start so the first-frame time is real, not the post-handshake time.
    const forward = async () => {
      for await (const frame of this.input) {
        if (this.abortSignal.aborted) return;
        if (frame === stt.SpeechStream.FLUSH_SENTINEL) continue;
        if (!receivedFirst) {
          receivedFirst = true;
          diagnose('asr-first-frame', { receivedSamples: frame.samplesPerChannel });
        }
        if (!ready) {
          queuedSamples += frame.samplesPerChannel;
          if (queuedSamples > MAX_QUEUED_SAMPLES) throw new Error('ASR handshake queue limit');
          queued.push(frame);
          continue;
        }
        sendFrame(frame);
      }
    };
    try { await Promise.race([forward(), failure, aborted]); }
    finally { clearTimeout(timer); this.abortSignal.removeEventListener('abort', cancel); queued.length = 0; socket.terminate(); }
  }
}
