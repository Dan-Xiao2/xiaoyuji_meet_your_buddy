import { voice, llm } from '@livekit/agents';
import { createQuickTutorReplyWithQwen, streamQuickTutorReplyWithQwen } from '../server/qwenTutor.mjs';
import { createTutorContext } from '../src/services/tutorContext.js';
import { checkChildSafety, checkTutorSafetyOutput } from '../src/services/safety.js';
import { conversationEndReply } from '../src/services/conversationIntent.js';
import { openSpeechStream } from '../server/speechStream.mjs';
import { resolveVisualPlan } from '../src/whiteboard/visualPlan.js';
import { providerStream, pcmFrames } from './streams.mjs';

const SENTENCE_END = /^([\s\S]*?[。！？!?]+)/u;
const FALLBACK_REPLY = '我听到了。我们一起想一想。';
const UNSAFE_REPLY = '这句话我需要再确认，不能随便给你建议。';
const speakable = text => /[\p{L}\p{N}]/u.test(text);
const elapsedSince = start => Math.round((performance.now() - start) * 10) / 10;
const whenAborted = signal => (signal.aborted ? Promise.resolve() : new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })));

class CompanionLLM extends llm.LLM {
  constructor(generate) { super(); this.generate = generate; }
  label() { return 'xiaoyu.CompanionLLM'; }
  chat(options) { return new CompanionLLMStream(this, options); }
}
class CompanionLLMStream extends llm.LLMStream {
  constructor(model, options) { super(model, { ...options, connOptions: options.connOptions || { maxRetry: 0, timeoutMs: 10000, retryIntervalMs: 0 } }); this.generate = model.generate; this.context = options.chatCtx; }
  async run() {
    const signal = this.abortController.signal;
    const output = await this.generate(this.context, signal);
    signal.throwIfAborted();
    if (!output) return;
    const put = text => this.queue.put({ id: 'xiaoyu-reply', delta: { role: 'assistant', content: text } });
    // A string is a whole reply; an async iterable is a reply delivered sentence by sentence.
    if (typeof output === 'string') { put(output); return; }
    for await (const text of output) { signal.throwIfAborted(); put(text); }
  }
}

export class Companion extends voice.Agent {
  // reply: whole-reply provider. replyStream: sentence-by-sentence provider, so speech can start
  // before the model has finished. Supplying only `reply` keeps the whole-reply path; by default
  // the reply is streamed (VOICE_LAB_STREAM_REPLY=false turns that off).
  // onTiming receives { stage, elapsedMs } records; they carry no text.
  constructor({ ageBand = '4-5', reply, replyStream, audio = openSpeechStream, onEnd = () => {}, onGenerated = () => {}, onTiming = () => {} } = {}) {
    let agent;
    super({ instructions: '你是小宇。使用现有小宇业务规则回应。', llm: new CompanionLLM((context, signal) => agent.generate(context, signal)) });
    agent = this;
    this.ageBand = ageBand;
    this.reply = reply ?? createQuickTutorReplyWithQwen;
    this.replyStream = replyStream ?? (reply || process.env.VOICE_LAB_STREAM_REPLY === 'false' ? null : streamQuickTutorReplyWithQwen);
    this.audio = audio;
    this.onEnd = onEnd;
    this.onGenerated = onGenerated;
    this.onTiming = (record) => { try { onTiming(record); } catch { /* timing must not affect the reply */ } };
  }
  async generate(chatCtx, signal) {
      const startedAt = performance.now();
      const messages = chatCtx.items.filter(item => item.type === 'message' && ['user', 'assistant'].includes(item.role));
      const current = messages.at(-1);
      if (current?.role !== 'user' || !current.textContent?.trim()) return;
      const input = current.textContent.slice(0, 4000);
      // An interrupted SDK transcript may be estimated, without word/audio alignment.
      // Omit it from model context rather than assert the child heard that text.
      const context = createTutorContext({ profile: { ageBand: this.ageBand },
        messages: messages.slice(0, -1).filter(item => !item.interrupted).map(item => ({
          role: item.role === 'user' ? 'child' : 'tutor', text: item.textContent || ''
        })) });
      const safety = checkChildSafety(input, context);
      const visual = safety.ok && resolveVisualPlan(input, context);
      if (safety.ok && !visual && this.replyStream) return this.streamReply(input, context, signal, startedAt);
      const result = !safety.ok ? { reply: safety.reply } : visual ? { reply: '这个语音实验还不能画画，我们可以聊聊你想画的东西。' } : await this.reply(input, context, FALLBACK_REPLY, { signal });
      signal.throwIfAborted();
      const text = checkTutorSafetyOutput(result.reply).ok ? result.reply : UNSAFE_REPLY;
      this.onGenerated({ text, modelUsed: Boolean(result.llmStatus?.used) });
      if (conversationEndReply(input)) this.onEnd();
      return text;
  }
  // Releases each sentence as the model finishes it. The business layer already checks every
  // sentence; it is checked again here because this is the last step before speech.
  async *streamReply(input, context, signal, startedAt) {
    const sentences = [];
    let modelUsed = false;
    const iterator = this.replyStream(input, context, FALLBACK_REPLY, { signal })[Symbol.asyncIterator]();
    const aborted = whenAborted(signal).then(() => null);
    try {
      for (;;) {
        // Race against cancellation so a stalled provider cannot hold the turn open.
        const step = await Promise.race([iterator.next(), aborted]);
        signal.throwIfAborted();
        if (step.done) break;
        const item = step.value;
        if (item.type === 'done') { modelUsed = Boolean(item.llmStatus?.used); continue; }
        if (item.type !== 'sentence' || !String(item.text || '').trim()) continue;
        if (!checkTutorSafetyOutput(sentences.join('') + item.text).ok) {
          if (!sentences.length) { sentences.push(UNSAFE_REPLY); yield UNSAFE_REPLY; }
          break;
        }
        if (!sentences.length) this.onTiming({ stage: 'llm-first-sentence', elapsedMs: elapsedSince(startedAt) });
        sentences.push(item.text);
        yield item.text;
      }
    } finally {
      // Not awaited: when cancelled, the provider may still be unwinding.
      Promise.resolve(iterator.return?.()).catch(() => {});
    }
    signal.throwIfAborted();
    if (!sentences.length) { sentences.push(FALLBACK_REPLY); yield FALLBACK_REPLY; }
    this.onTiming({ stage: 'llm-done', elapsedMs: elapsedSince(startedAt), sentences: sentences.length });
    this.onGenerated({ text: sentences.join(''), modelUsed });
    if (conversationEndReply(input)) this.onEnd();
  }
  // Speech is requested one sentence at a time. The request for the next sentence starts as soon as
  // it is known, while the previous one is still playing, so there is no gap between sentences.
  async ttsNode(text) {
    return providerStream(async (emit, signal) => {
      const startedAt = performance.now();
      const inner = new AbortController();
      const requestSignal = AbortSignal.any([signal, inner.signal]);
      const requests = [];
      let wake = null, finished = false, failure = null, announced = false;
      const request = sentence => {
        if (!speakable(sentence) || requestSignal.aborted) return;
        const audio = (async () => this.audio(sentence.trim(), requestSignal))();
        audio.catch(() => {}); // surfaced when its turn comes; never an unhandled rejection
        requests.push(audio);
        wake?.(); wake = null;
      };
      void (async () => {
        try {
          let buffer = '';
          for await (const chunk of text) {
            signal.throwIfAborted();
            buffer += chunk;
            for (let match; (match = SENTENCE_END.exec(buffer));) { buffer = buffer.slice(match[0].length); request(match[1]); }
          }
          request(buffer);
        } catch (error) { failure = error; }
        finally { finished = true; wake?.(); wake = null; }
      })();
      try {
        for (;;) {
          if (!requests.length) {
            if (finished) break;
            await new Promise(resolve => { wake = resolve; });
            continue;
          }
          const audio = await requests.shift();
          for await (const frame of pcmFrames(audio, { signal })) {
            emit(frame);
            if (!announced) { announced = true; this.onTiming({ stage: 'tts-first-frame', elapsedMs: elapsedSince(startedAt) }); }
          }
        }
        if (failure) throw failure;
      } finally { inner.abort(); }
    });
  }
}
