import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { initializeLogger } from '@livekit/agents';
import { measureOnset, speechOnsetMs, parseWav } from '../scripts/probe-asr-onset.mjs';
initializeLogger({ level: 'silent', pretty: false });

const RATE = 16000;
// 500 ms of silence, then 1 s of a loud tone.
function sample() {
  const pcm = Buffer.alloc((RATE * 1.5) * 2);
  for (let i = RATE / 2; i < RATE * 1.5; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2);
  return pcm;
}

test('speech onset is found from the sample itself', () => {
  assert.equal(speechOnsetMs(sample()), 500);
  assert.equal(speechOnsetMs(Buffer.alloc(32000)), null);
});

test('only mono 16 kHz PCM16 WAV is accepted', () => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(44100, 24); header.writeUInt16LE(16, 34);
  header.write('data', 36);
  assert.throws(() => parseWav(header), /mono 16 kHz/);
});

test('reports how far the provider start lags the true start, including added leading silence', async () => {
  let socket;
  class Socket extends EventEmitter {
    bufferedAmount = 0; appended = 0; announced = false;
    send(raw) {
      const message = JSON.parse(raw);
      if (message.type === 'session.update') queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'session.updated' })));
      if (message.type === 'input_audio_buffer.append') {
        this.appended += Buffer.from(message.audio, 'base64').length / 2;
        // The provider "notices" speech 200 ms after it really starts (true start 500 + 300 lead = 800 ms).
        if (!this.announced && this.appended / RATE * 1000 >= 1000) {
          this.announced = true;
          this.emit('message', JSON.stringify({ type: 'input_audio_buffer.speech_started', audio_start_ms: 1000 }));
          this.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '为什么是蓝色的' }));
        }
      }
    }
    terminate() { this.emit('close'); }
  }
  const result = await measureOnset({ pcm: sample(), leadSilenceMs: 300, paced: false,
    config: { enabled: true, endpoint: 'wss://test.invalid', key: 'synthetic', language: 'zh' },
    connect: () => { socket = new Socket(); queueMicrotask(() => socket.emit('open')); return socket; } });
  assert.equal(result.trueOnsetMs, 800);
  assert.equal(result.serverAudioStartMs, 1000);
  assert.equal(result.serverStartLagMs, 200);
  assert.equal(result.transcript, '为什么是蓝色的');
  assert.equal(typeof result.firstFrameToFirstAppendMs, 'number');
  assert.equal(JSON.stringify(result).includes('synthetic'), false); // the key never reaches the report
});
