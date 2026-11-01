// Where does the quick reply's time-to-first-sentence go, and does a shorter prompt help?
// Captures the exact streaming request the app would send, then times prompt variants
// (request → first token → first sentence → done) on warm connections, interleaved so
// provider drift affects every variant alike. Fixed synthetic input only.
//
//   node scripts/probe-llm-first-sentence.mjs --live [--rounds=4] [--input=天空为什么是蓝色的？]
import { writeFile, mkdir } from 'node:fs/promises';
import { createParser } from 'eventsource-parser';
import { loadLocalEnv } from '../server/env.mjs';
import { createProviderWarmup } from '../server/providerWarmup.mjs';
import { createTutorContext } from '../src/services/tutorContext.js';

const SENTENCE_END = /[。！？!?]/u;

// The knowledge context is the last block of the system prompt: a pretty-printed JSON object.
export function splitKnowledge(system) {
  const start = system.indexOf('\n{');
  if (start < 0) return { rules: system, knowledge: null };
  try { return { rules: system.slice(0, start), knowledge: JSON.parse(system.slice(start + 1)) }; }
  catch { return { rules: system, knowledge: null }; }
}

export function variants(body) {
  const system = body.messages[0].content;
  const { rules, knowledge } = splitKnowledge(system);
  const withSystem = content => ({ ...body, messages: [{ ...body.messages[0], content }, body.messages[1]] });
  const lines = rules.split('\n');
  return {
    current: body,
    compactKnowledge: knowledge ? withSystem(`${rules}\n${JSON.stringify(knowledge)}`) : body,
    noKnowledge: withSystem(rules),
    // Lower bound only: role, age and length rules without safety/drawing rules. Not deployable.
    minimal: withSystem([lines[0], ...lines.filter(line => line.startsWith('年龄段') || line.startsWith('直接回应'))].join('\n'))
  };
}

async function timeOnce(baseUrl, body) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QWEN_API_KEY}` },
    body: JSON.stringify(body) });
  const headers = performance.now();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let text = '', firstToken = null, firstSentence = null, usage = null;
  const parser = createParser({ onEvent: ({ data }) => {
    if (data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.usage) usage = event.usage;
    const delta = event.choices?.[0]?.delta?.content || '';
    if (!delta) return;
    if (firstToken === null) firstToken = performance.now();
    text += delta;
    if (firstSentence === null && SENTENCE_END.test(text)) firstSentence = performance.now();
  } });
  const decoder = new TextDecoder();
  for await (const chunk of response.body) parser.feed(decoder.decode(chunk, { stream: true }));
  const ms = value => (value == null ? null : Math.round(value - start));
  return { headersMs: ms(headers), firstTokenMs: ms(firstToken), firstSentenceMs: ms(firstSentence), doneMs: ms(performance.now()),
    promptTokens: usage?.prompt_tokens ?? null, completionTokens: usage?.completion_tokens ?? null, reply: text };
}

if (process.argv[1]?.endsWith('probe-llm-first-sentence.mjs')) {
  if (!process.argv.includes('--live')) throw new Error('Explicit --live is required: this sends real model requests');
  loadLocalEnv(process.cwd());
  if (!process.env.QWEN_API_KEY) { console.error('真实模型未配置，未发起任何请求。'); process.exit(2); }
  const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const rounds = Math.min(8, Number(arg('rounds') || 4));
  const input = arg('input') || '天空为什么是蓝色的？';
  // Capture the exact request the app builds, without sending it.
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { captured = JSON.parse(options.body); throw new Error('captured'); };
  const { streamQuickTutorReplyWithQwen } = await import('../server/qwenTutor.mjs');
  const state = createTutorContext({ profile: { ageBand: '4-5' }, messages: [] });
  try { for await (const item of streamQuickTutorReplyWithQwen(input, state, '我们一起想一想。')) void item; } catch { /* captured */ }
  globalThis.fetch = realFetch;
  if (!captured) throw new Error('No model request was built (local rule answered?)');
  const baseUrl = process.env.QWEN_BASE_URL.replace(/\/$/, '');
  const warm = createProviderWarmup({ sockets: 1 });
  const set = variants(captured), results = [];
  for (let round = 0; round < rounds; round++) {
    for (const [name, body] of Object.entries(set)) {
      await warm();
      const result = { round: round + 1, variant: name, systemChars: body.messages[0].content.length, ...(await timeOnce(baseUrl, body)) };
      results.push(result);
      console.log(JSON.stringify({ ...result, reply: result.reply.slice(0, 40) }));
    }
  }
  const dir = process.env.VOICE_LAB_REPORT_DIR || 'reports/voice-lab-live';
  await mkdir(dir, { recursive: true });
  const file = `${dir}/llm-first-sentence-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(file, JSON.stringify({ syntheticInput: true, input, model: captured.model, results }, null, 2));
  console.log(`完整报告：${file}`);
}
