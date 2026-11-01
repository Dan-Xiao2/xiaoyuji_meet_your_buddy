// Where does TTS time-to-first-frame go? Splits one streaming TTS request into
// request → response headers → first SSE audio chunk → first 20 ms frame, for a cold and then a
// warm connection and for short/long sentences. Fixed synthetic text only; at most `--runs` requests.
//
//   node scripts/probe-tts-first-frame.mjs --live [--runs=6]
import { writeFile, mkdir } from 'node:fs/promises';
import diagnostics from 'node:diagnostics_channel';
import { loadLocalEnv } from '../server/env.mjs';
import { getSpeechStatus } from '../server/qwenSpeech.mjs';
import { openSpeechStream } from '../server/speechStream.mjs';
import { pcmFrames } from '../voice-agent/streams.mjs';

const SENTENCES = ['因为阳光里有各种颜色。', '天空里的小灰尘把蓝色的光撞得到处跑，所以我们看到的天空就是蓝蓝的。'];

// Wraps fetch so the time the response headers arrive is visible without changing openSpeechStream.
// New sockets are counted through undici's diagnostics channel, so a reused keep-alive connection
// and a fresh TCP+TLS handshake can be told apart.
let connections = 0;
diagnostics.subscribe('undici:client:connected', () => { connections++; });
function timedFetch(marks) {
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    marks.fetchStart = performance.now();
    const response = await original(...args);
    marks.headers = performance.now();
    marks.connectionHeader = response.headers.get('connection');
    marks.keepAlive = response.headers.get('keep-alive');
    return response;
  };
  return () => { globalThis.fetch = original; };
}

export async function measureOnce(text, open = openSpeechStream) {
  const marks = {};
  const connectionsBefore = connections;
  const restore = timedFetch(marks);
  const start = performance.now();
  let firstChunkBytes = null, firstChunk = null, firstFrame = null, totalBytes = 0;
  try {
    const chunks = await open(text);
    const tap = async function* () {
      for await (const chunk of chunks) {
        if (firstChunk === null) { firstChunk = performance.now(); firstChunkBytes = chunk.length; }
        totalBytes += chunk.length;
        yield chunk;
      }
    };
    for await (const frame of pcmFrames(tap())) { if (firstFrame === null) firstFrame = performance.now(); void frame; }
  } finally { restore(); }
  const end = performance.now(), ms = value => (value == null ? null : Math.round(value - start));
  return { characters: text.length, newConnections: connections - connectionsBefore,
    connectionHeader: marks.connectionHeader ?? null, keepAlive: marks.keepAlive ?? null, headersMs: ms(marks.headers), firstChunkMs: ms(firstChunk), firstFrameMs: ms(firstFrame),
    firstChunkBytes, firstChunkAudioMs: firstChunkBytes == null ? null : Math.round(firstChunkBytes / 48), totalMs: ms(end),
    audioMs: Math.round(totalBytes / 48) };
}

if (process.argv[1]?.endsWith('probe-tts-first-frame.mjs')) {
  if (!process.argv.includes('--live')) throw new Error('Explicit --live is required: this sends real TTS requests');
  loadLocalEnv(process.cwd());
  const status = getSpeechStatus().tts;
  if (status.provider !== 'qwen' || !status.configured) { console.error('真实TTS未配置，未发起任何请求。'); process.exit(2); }
  const runs = Math.min(10, Number(process.argv.find(item => item.startsWith('--runs='))?.split('=')[1] || 6));
  const results = [];
  for (let i = 0; i < runs; i++) {
    // Runs 1–2: the same short sentence on a cold then a warm connection; afterwards long and short alternate.
    const text = SENTENCES[i >= 2 && i % 2 === 1 ? 1 : 0];
    results.push({ run: i + 1, connection: i === 0 ? 'cold' : 'warm', ...(await measureOnce(text)) });
    console.log(JSON.stringify(results.at(-1)));
  }
  const dir = process.env.VOICE_LAB_REPORT_DIR || 'reports/voice-lab-live';
  await mkdir(dir, { recursive: true });
  const file = `${dir}/tts-first-frame-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(file, JSON.stringify({ syntheticText: true, model: status.model, voice: status.voice, results }, null, 2));
  console.log(`完整报告：${file}`);
}
