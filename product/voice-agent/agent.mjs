import { cli, defineAgent, ServerOptions, voice, stt } from '@livekit/agents';
import { RoomEvent } from '@livekit/rtc-node';
import { VAD } from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../server/env.mjs';
import { QwenSTT } from './qwenStt.mjs';
import { Companion } from './companion.mjs';
import { SyntheticSTT, syntheticReply, syntheticAudio } from './syntheticProviders.mjs';

loadLocalEnv(fileURLToPath(new URL('../', import.meta.url)));
export default defineAgent({
  prewarm: async proc => { proc.userData.vad = await VAD.load({ forceCPU: true, minSilenceDuration: 650 }); },
  entry: async ctx => {
    const meta = JSON.parse(ctx.job.metadata || '{}');
    if (!/^voice-lab-[\w-]+$/.test(meta.sessionId || '') || !meta.identity) throw new Error('Missing lab session identity');
    const synthetic = process.env.VOICE_LAB_PROVIDER === 'synthetic';
    let stopped = false, sequence = 0, endingSpeechId = null, currentSpeechId = null, started = false;
    // The synthetic provider has no recogniser that can prove audio arrived, so it is ready once started.
    // The real provider is ready only after its first audio frame has been appended to the recogniser.
    let inputReady = synthetic;
    const readyState = () => ({ provider: synthetic ? 'synthetic' : 'qwen', state: session.agentState, inputReady });
    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad,
      stt: synthetic ? new stt.StreamAdapter(new SyntheticSTT(), ctx.proc.userData.vad) : new QwenSTT({
        onInputReady: () => { if (inputReady) return; inputReady = true; if (started) publish('ready', readyState()); },
        onDiagnostics: event => publish('timing', event)
      }),
      turnHandling: { turnDetection: 'stt', endpointing: { minDelay: 0, maxDelay: 2000 },
        interruption: { enabled: true, mode: 'vad', minDuration: 400, minWords: 0, resumeFalseInterruption: false },
        preemptiveGeneration: { enabled: false } },
      connOptions: { sttConnOptions: { maxRetry: 0 }, ttsConnOptions: { maxRetry: 0 } }
    });
    const publish = (type, data = {}) => {
      if (stopped) return;
      const message = { type, sessionId: meta.sessionId, seq: ++sequence, at: Date.now(), ...data };
      ctx.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: 'xiaoyu.voice-lab' }).catch(() => {});
    };
    const stop = async () => {
      if (stopped) return;
      publish('ended'); stopped = true;
      await session.close();
      await ctx.shutdown('voice-lab-ended');
    };
    const agent = new Companion({ ageBand: meta.ageBand,
      ...(synthetic ? { reply: syntheticReply, audio: syntheticAudio } : {}),
      onEnd: () => { endingSpeechId = currentSpeechId; },
      onGenerated: result => publish('generated', { ...result, playoutConfirmed: false }),
      onTiming: event => publish('timing', event)
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => publish('state', { state: event.newState }));
    session.on(voice.AgentSessionEventTypes.UserStateChanged, event => publish('user-state', { state: event.newState }));
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, event => {
      if (event.isFinal) publish('transcript', { text: event.transcript });
    });
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, event => {
      if (event.item.role === 'assistant') publish('playout', { text: event.item.textContent || '', interrupted: event.item.interrupted,
        alignment: 'sdk-estimate', playoutConfirmed: false });
    });
    session.on(voice.AgentSessionEventTypes.SpeechCreated, event => {
      const handle = event.speechHandle;
      currentSpeechId = handle.id;
      publish('speech', { speechId: handle.id });
      handle.waitForPlayout().then(() => {
        publish('speech-ended', { speechId: handle.id, interrupted: handle.interrupted });
        if (!handle.interrupted && endingSpeechId === handle.id) return stop();
      }).catch(() => {});
    });
    session.on(voice.AgentSessionEventTypes.Error, () => { publish('failure'); void stop(); });
    ctx.room.on(RoomEvent.DataReceived, (bytes, participant, kind, topic) => {
      if (stopped || participant?.identity !== meta.identity || topic !== 'xiaoyu.voice-lab.control' || bytes.length > 5000) return;
      try {
        const message = JSON.parse(new TextDecoder().decode(bytes));
        if (message.sessionId !== meta.sessionId) return;
        if (message.type === 'hello') { if (started) publish('ready', readyState()); }
        if (message.type === 'stop') void stop();
        if (message.type === 'interrupt') void session.interrupt();
        if (message.type === 'text' && typeof message.text === 'string' && message.text.trim() && message.text.length <= 1000) {
          session.generateReply({ userInput: message.text });
        }
      } catch { /* Ignore invalid control messages. */ }
    });
    ctx.addShutdownCallback(async () => { stopped = true; await session.close(); });
    await ctx.connect();
    await session.start({ agent, room: ctx.room, record: false,
      inputOptions: { participantIdentity: meta.identity, textEnabled: false, videoEnabled: false } });
    started = true;
    publish('ready', readyState());
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: 'xiaoyu-voice-lab',
    host: '127.0.0.1', port: Number(process.env.VOICE_AGENT_PORT || 8087), numIdleProcesses: 1, drainTimeout: 1000, shutdownProcessTimeout: 5000,
    initializeProcessTimeout: 30000, logLevel: 'warn' }));
}
