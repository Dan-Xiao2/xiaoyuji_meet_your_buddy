// Exactly one ASR segment, one quick LLM request and one TTS request. No automatic retries.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { initializeLogger, llm, stt } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';
import { loadLocalEnv } from '../server/env.mjs';
import { realtimeAsrConfig } from '../server/realtimeAsr.mjs';
import { getSpeechStatus } from '../server/qwenSpeech.mjs';
import { createQuickTutorReplyWithQwen } from '../server/qwenTutor.mjs';
import { openSpeechStream } from '../server/speechStream.mjs';
import { QwenSTT } from '../voice-agent/qwenStt.mjs';
import { Companion } from '../voice-agent/companion.mjs';

if (!process.argv.includes('--live')) throw new Error('Explicit --live and an approved budget are required');
loadLocalEnv(process.cwd());
initializeLogger({ level: 'silent', pretty: false });
const settings = realtimeAsrConfig(), speech = getSpeechStatus();
if (!settings.enabled || speech.tts.provider !== 'qwen' || !speech.tts.configured || process.env.TUTOR_ENABLE_LLM !== 'true') {
  console.error('真实服务未就绪：请在本地.env配置QWEN_API_KEY及地域，并启用TUTOR_ENABLE_LLM和USE_CLOUD_TTS。未发起付费请求。');
  process.exitCode = 2;
} else {
  const output = process.env.VOICE_LAB_REPORT_DIR || 'reports/voice-lab-live';
  await mkdir(output, { recursive: true });
  const wav = process.env.VOICE_LAB_LIVE_WAV || '/private/tmp/xiaoyu-voice-lab-zh.wav';
  if (!process.env.VOICE_LAB_LIVE_WAV) {
    for (const [command, args] of [['/usr/bin/say', ['-v', 'Tingting', '-o', '/private/tmp/xiaoyu-voice-lab-zh.aiff', '天空为什么是蓝色的？']],
      ['/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', '/private/tmp/xiaoyu-voice-lab-zh.aiff', wav]]]) {
      const result = spawnSync(command, args, { stdio: 'ignore' });
      if (result.status !== 0) throw new Error('Provide a synthetic mono 16kHz PCM WAV via VOICE_LAB_LIVE_WAV');
    }
  }
  const source = await readFile(wav);
  let format, pcm;
  for (let offset = 12; offset + 8 <= source.length;) {
    const tag = source.toString('ascii', offset, offset + 4), size = source.readUInt32LE(offset + 4);
    if (tag === 'fmt ') format = source.subarray(offset + 8, offset + 8 + size);
    if (tag === 'data') pcm = source.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!format || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 || format.readUInt32LE(4) !== 16000 || format.readUInt16LE(14) !== 16 || !pcm || pcm.length > 320000) throw new Error('Use at most ten seconds of mono 16kHz PCM16 synthetic audio');
  const report = { syntheticInput: true, budgetCeilingCny: 10, maximumRequests: { asr: 1, llm: 1, tts: 1 },
    providerHost: new URL(settings.endpoint).host, model: settings.model, audioSeconds: pcm.length / 32000,
    billing: 'Actual billing not available from this process; request counts are bounded.' };
  const provider = new QwenSTT({ config: settings });
  provider.on('error', () => {});
  const stream = provider.stream({ connOptions: { maxRetry: 0, timeoutMs: 15000, retryIntervalMs: 0 } });
  let transcript = '';
  const deadline = setTimeout(() => stream.close(), 20000);
  const started = performance.now();
  let recognitionError;
  const consume = (async () => {
    for await (const event of stream) if (event.type === stt.SpeechEventType.FINAL_TRANSCRIPT) { transcript = event.alternatives[0].text; break; }
  })().catch(error => { recognitionError = error; });
  try {
    const samples = Buffer.concat([pcm, Buffer.alloc(32000)]);
    for (let offset = 0; offset < samples.length && !transcript && !recognitionError; offset += 640) {
      const bytes = samples.subarray(offset, offset + 640);
      const data = new Int16Array(bytes.length / 2);
      for (let i = 0; i < data.length; i++) data[i] = bytes.readInt16LE(i * 2);
      stream.pushFrame(new AudioFrame(data, 16000, 1, data.length));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await consume;
    if (recognitionError) throw recognitionError;
  } finally { clearTimeout(deadline); stream.close(); await provider.close(); }
  if (!transcript) throw new Error('ASR returned no final transcript; not retried');
  report.asr = { transcript, latencyMs: Math.round(performance.now() - started) };
  let modelUsed = false, usage;
  const agent = new Companion({ reply: async (...args) => {
    const result = await createQuickTutorReplyWithQwen(...args); modelUsed = result.llmStatus.used;
    usage = result.llmStatus.tokenUsage; return result;
  } });
  const context = new llm.ChatContext(); context.addMessage({ role: 'user', content: transcript });
  const generation = agent.llm.chat({ chatCtx: context });
  let reply = '';
  for await (const chunk of generation) reply += chunk.delta?.content || '';
  generation.close();
  if (!modelUsed || !reply) throw new Error('LLM used fallback or returned no reply; TTS not requested');
  report.llm = { reply, modelUsed, usage };
  const audio = [], audioStarted = performance.now(); let first = null;
  for await (const chunk of await openSpeechStream(reply, AbortSignal.timeout(20000))) {
    first ??= performance.now(); audio.push(chunk);
  }
  const bytes = Buffer.concat(audio);
  if (!bytes.length) throw new Error('No TTS PCM returned');
  await writeFile(`${output}/reply.pcm`, bytes);
  report.tts = { pcmBytes: bytes.length, sampleRate: 24000, seconds: bytes.length / 48000, firstChunkMs: Math.round(first - audioStarted) };
  await writeFile(`${output}/receipt.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
