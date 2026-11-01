// One real ASR session. Answers: does the provider's server-side VAD start listening after the
// true start of speech, so the first word is clipped? Compare where speech really begins in a
// known synthetic sample with where the provider says (and when we saw it say) it began.
// Sends at most one ASR session. No LLM, no TTS. Synthetic audio only; never a child's voice.
//
//   VOICE_LAB_LIVE_WAV=/path/mono-16k-pcm16.wav node scripts/probe-asr-onset.mjs --live [--lead-ms=0] [--expect=天空为什么是蓝色的]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { initializeLogger, stt } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';
import { loadLocalEnv } from '../server/env.mjs';
import { realtimeAsrConfig } from '../server/realtimeAsr.mjs';
import { QwenSTT } from '../voice-agent/qwenStt.mjs';

const RATE = 16000, FRAME_SAMPLES = 320; // 20 ms

export function parseWav(source) {
  let format, pcm;
  for (let offset = 12; offset + 8 <= source.length;) {
    const tag = source.toString('ascii', offset, offset + 4), size = source.readUInt32LE(offset + 4);
    if (tag === 'fmt ') format = source.subarray(offset + 8, offset + 8 + size);
    if (tag === 'data') pcm = source.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!format || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 || format.readUInt32LE(4) !== RATE || format.readUInt16LE(14) !== 16 || !pcm) {
    throw new Error('Use mono 16 kHz PCM16 WAV');
  }
  if (pcm.length > RATE * 2 * 10) throw new Error('Use at most ten seconds of audio');
  return pcm;
}

// First 20 ms frame whose RMS clearly exceeds the noise floor, in milliseconds.
export function speechOnsetMs(pcm, { threshold = 400 } = {}) {
  for (let start = 0; start + FRAME_SAMPLES * 2 <= pcm.length; start += FRAME_SAMPLES * 2) {
    let sum = 0;
    for (let i = 0; i < FRAME_SAMPLES; i++) { const v = pcm.readInt16LE(start + i * 2); sum += v * v; }
    if (Math.sqrt(sum / FRAME_SAMPLES) > threshold) return start / 2 / RATE * 1000;
  }
  return null;
}

export async function measureOnset({ pcm, leadSilenceMs = 0, tailSilenceMs = 1500, config, connect, paced = true, timeoutMs = 20000 }) {
  const trueOnsetInFile = speechOnsetMs(pcm);
  if (trueOnsetInFile === null) throw new Error('No speech found in the sample');
  const trueOnsetMs = trueOnsetInFile + leadSilenceMs;
  const samples = Buffer.concat([Buffer.alloc(Math.round(leadSilenceMs * RATE / 1000) * 2), pcm, Buffer.alloc(Math.round(tailSilenceMs * RATE / 1000) * 2)]);
  const diagnostics = [];
  const provider = new QwenSTT({ config, ...(connect ? { connect } : {}), onDiagnostics: event => diagnostics.push(event) });
  provider.on('error', () => {});
  const stream = provider.stream({ connOptions: { maxRetry: 0 } });
  let transcript = '', failure = null;
  const deadline = setTimeout(() => stream.close(), timeoutMs);
  const consume = (async () => {
    for await (const event of stream) if (event.type === stt.SpeechEventType.FINAL_TRANSCRIPT) { transcript = event.alternatives[0].text; break; }
  })().catch(error => { failure = error; });
  try {
    for (let offset = 0; offset < samples.length && !transcript && !failure; offset += FRAME_SAMPLES * 2) {
      const bytes = samples.subarray(offset, offset + FRAME_SAMPLES * 2);
      const data = new Int16Array(bytes.length / 2);
      for (let i = 0; i < data.length; i++) data[i] = bytes.readInt16LE(i * 2);
      stream.pushFrame(new AudioFrame(data, RATE, 1, data.length));
      if (paced) await new Promise(resolve => setTimeout(resolve, 20)); // real time, as a microphone would deliver
      else await new Promise(resolve => setImmediate(resolve));
    }
    stream.endInput();
    await Promise.race([consume, new Promise(resolve => setTimeout(resolve, 3000))]);
  } finally { clearTimeout(deadline); stream.close(); await provider.close(); }
  const started = diagnostics.find(item => item.stage === 'asr-speech-started');
  const detectedMs = started ? started.appendedSamples / RATE * 1000 : null;
  return {
    leadSilenceMs, trueOnsetMs,
    detectedByAppendedMs: detectedMs,
    detectedLagMs: detectedMs === null ? null : Math.round(detectedMs - trueOnsetMs),
    serverAudioStartMs: started?.serverAudioStartMs ?? null,
    serverStartLagMs: started?.serverAudioStartMs == null ? null : Math.round(started.serverAudioStartMs - trueOnsetMs),
    transcript, error: failure ? 'recognition failed' : null,
    firstFrameToFirstAppendMs: (() => {
      const frame = diagnostics.find(item => item.stage === 'asr-first-frame'), append = diagnostics.find(item => item.stage === 'asr-first-append');
      return frame && append ? Math.round((append.elapsedMs - frame.elapsedMs) * 10) / 10 : null;
    })(),
    diagnostics
  };
}

function interpret(result, expect) {
  const notes = [];
  if (result.serverStartLagMs !== null) {
    notes.push(result.serverStartLagMs > 60
      ? `服务端自报的说话起点比真实起点晚 ${result.serverStartLagMs}ms：开头约这么长的语音可能没进入识别。支持“服务端VAD裁掉开头”的假设。`
      : `服务端自报的起点与真实起点相差 ${result.serverStartLagMs}ms：起点本身没有明显偏晚。`);
  } else notes.push('服务端没有给出 audio_start_ms，只能看事件到达时已追加的音频位置（detectedLagMs，包含检测延迟，仅作参考）。');
  if (expect) notes.push(result.transcript.startsWith(expect.slice(0, 2)) ? '转写开头与预期一致。' : `转写开头与预期不一致：预期以“${expect.slice(0, 2)}”开头。`);
  return notes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--live')) throw new Error('Explicit --live is required: this sends one real ASR session');
  loadLocalEnv(process.cwd());
  initializeLogger({ level: 'silent', pretty: false });
  const config = realtimeAsrConfig();
  if (!config.enabled) { console.error('真实ASR未配置：请在本地.env配置QWEN_API_KEY。未发起任何请求。'); process.exit(2); }
  const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const wav = process.env.VOICE_LAB_LIVE_WAV || '/private/tmp/xiaoyu-voice-lab-zh.wav';
  if (!process.env.VOICE_LAB_LIVE_WAV && process.platform === 'darwin') {
    for (const [command, args] of [['/usr/bin/say', ['-v', 'Tingting', '-o', '/private/tmp/xiaoyu-voice-lab-zh.aiff', '天空为什么是蓝色的？']],
      ['/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', '/private/tmp/xiaoyu-voice-lab-zh.aiff', wav]]]) {
      if (spawnSync(command, args, { stdio: 'ignore' }).status !== 0) throw new Error('Provide a synthetic mono 16 kHz PCM16 WAV via VOICE_LAB_LIVE_WAV');
    }
  }
  const expect = arg('expect') || (process.env.VOICE_LAB_LIVE_WAV ? '' : '天空为什么是蓝色的');
  const result = await measureOnset({ pcm: parseWav(await readFile(wav)), leadSilenceMs: Number(arg('lead-ms') || 0), config });
  const report = { syntheticInput: true, maximumRequests: { asr: 1 }, providerHost: new URL(config.endpoint).host, model: config.model,
    ...result, notes: interpret(result, expect) };
  const dir = process.env.VOICE_LAB_REPORT_DIR || 'reports/voice-lab-live';
  await mkdir(dir, { recursive: true });
  const file = `${dir}/asr-onset-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, diagnostics: undefined }, null, 2));
  console.log(`完整报告：${file}`);
}
