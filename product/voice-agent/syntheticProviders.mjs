import { stt } from '@livekit/agents';

// Local transport test only: recognizes speech activity, not its words.
export class SyntheticSTT extends stt.STT {
  label = 'xiaoyu.SyntheticSTT';
  count = 0;
  constructor() { super({ streaming: false, interimResults: false }); }
  async _recognize() {
    return { type: stt.SpeechEventType.FINAL_TRANSCRIPT, alternatives: [{
      text: ++this.count === 1 ? '为什么天空是蓝色的' : '我想问一个新问题',
      language: 'zh', startTime: 0, endTime: 0, confidence: 0
    }] };
  }
  stream() { throw new Error('Synthetic STT requires the SDK VAD stream adapter'); }
}

export async function syntheticReply(input, state, fallback, { signal }) {
  signal.throwIfAborted();
  return { reply: '这是合成音频实验回应，用于验证真实媒体传输和停止，不代表语音识别或回答质量。', llmStatus: { used: false } };
}
export async function* syntheticAudio(text, signal) {
  // Twelve seconds makes a real overlap and a late-audio rejection observable.
  for (let block = 0; block < 600; block++) {
    signal.throwIfAborted();
    const bytes = Buffer.alloc(960);
    for (let i = 0; i < 480; i++) bytes.writeInt16LE(Math.round(Math.sin((block * 480 + i) * 2 * Math.PI * 440 / 24000) * 1600), i * 2);
    yield bytes;
  }
}
