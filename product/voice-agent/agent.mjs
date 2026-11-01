import { cli, defineAgent, ServerOptions, voice, stt } from '@livekit/agents';
import { RoomEvent } from '@livekit/rtc-node';
import { VAD } from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../server/env.mjs';
import { QwenSTT } from './qwenStt.mjs';
import { Companion } from './companion.mjs';
import { SyntheticSTT, syntheticReply, syntheticAudio } from './syntheticProviders.mjs';
import { createProviderWarmup } from '../server/providerWarmup.mjs';
import { installKeepAliveDispatcher } from '../server/httpKeepAlive.mjs';

loadLocalEnv(fileURLToPath(new URL('../', import.meta.url)));
installKeepAliveDispatcher();
export default defineAgent({
  prewarm: async proc => { proc.userData.vad = await VAD.load({ forceCPU: true, minSilenceDuration: 650 }); },
  entry: async ctx => {
    const meta = JSON.parse(ctx.job.metadata || '{}');
    if (!/^voice-lab-[\w-]+$/.test(meta.sessionId || '') || !meta.identity) throw new Error('Missing lab session identity');
    const synthetic = process.env.VOICE_LAB_PROVIDER === 'synthetic';
    let stopped = false, sequence = 0, endingSpeechId = null, currentSpeechId = null, started = false;
    // Readiness answers one client hello: the client's latest hello waits here until audio appended
    // to the recogniser AFTER it proves the microphone reaches us (again, after a reconnect). The
    // synthetic provider has no recogniser that can prove this, so it answers once started.
    let pendingHello = null;
    // Speech start warms two sockets: one for the model request, one for the first speech request
    // that starts while the model still streams. Not at the final transcript (see providerWarmup.mjs).
    const warmProvider = synthetic ? () => {} : createProviderWarmup();
    const readyState = (helloId, inputReady) => ({ provider: synthetic ? 'synthetic' : 'qwen', state: session.agentState, helloId, inputReady });
    const prove = () => {
      if (!started || pendingHello === null) return;
      const helloId = pendingHello;
      pendingHello = null;
      publish('ready', readyState(helloId, true));
    };
    // The SDK ignores interruptions AND discards microphone input for the first 3 s of the agent's
    // first speech in a session (echo-cancellation warm-up). A child speaking then is not heard.
    // Kept at the SDK default until real-device echo tests justify a shorter value.
    const aecWarmupMs = process.env.VOICE_LAB_AEC_WARMUP_MS;
    const session = new voice.AgentSession({
      ...(aecWarmupMs !== undefined && aecWarmupMs !== '' ? { aecWarmupDuration: Number(aecWarmupMs) || null } : {}),
      vad: ctx.proc.userData.vad,
      stt: synthetic ? new stt.StreamAdapter(new SyntheticSTT(), ctx.proc.userData.vad) : new QwenSTT({
        onAppend: prove,
        onDiagnostics: event => {
          if (event.stage === 'asr-speech-started') void warmProvider();
          publish('timing', event);
        }
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
        if (message.type === 'hello' && Number.isInteger(message.helloId)) {
          pendingHello = message.helloId;
          if (synthetic) prove(); else if (started) publish('ready', readyState(message.helloId, false));
        }
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
    if (synthetic) prove(); else publish('ready', readyState(pendingHello, false));
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: 'xiaoyu-voice-lab',
    host: '127.0.0.1', port: Number(process.env.VOICE_AGENT_PORT || 8087), numIdleProcesses: 1, drainTimeout: 1000, shutdownProcessTimeout: 5000,
    initializeProcessTimeout: 30000, logLevel: 'warn' }));
}
