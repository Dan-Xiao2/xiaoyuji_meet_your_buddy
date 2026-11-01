import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AccessToken, AgentDispatchClient, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { getSpeechStatus } from './qwenSpeech.mjs';
import { realtimeAsrConfig } from './realtimeAsr.mjs';

export function voiceLabConfig(env = process.env) {
  const provider = env.VOICE_LAB_PROVIDER === 'synthetic' ? 'synthetic' : 'qwen';
  return { enabled: env.VOICE_LAB_ENABLED === 'true', provider, url: env.LIVEKIT_URL || '',
    apiKey: env.LIVEKIT_API_KEY || '', apiSecret: env.LIVEKIT_API_SECRET || '' };
}

// Local adult experiment: no household identity, stored transcript or production authentication.
export function createVoiceLab({ config = voiceLabConfig, clients = settings => {
  const url = settings.url.replace(/^ws/, 'http');
  return { rooms: new RoomServiceClient(url, settings.apiKey, settings.apiSecret),
    dispatch: new AgentDispatchClient(url, settings.apiKey, settings.apiSecret) };
} } = {}) {
  const sessions = new Map();
  let starting = false;
  function status() {
    const settings = config();
    const speech = getSpeechStatus();
    const configured = Boolean(settings.url && settings.apiKey && settings.apiSecret);
    const providersReady = settings.provider === 'synthetic' || (realtimeAsrConfig().enabled && speech.tts.provider === 'qwen' && speech.tts.configured);
    return { enabled: settings.enabled, configured, providersReady, provider: settings.provider,
      available: settings.enabled && configured && providersReady };
  }
  async function start(body) {
    const availability = status();
    if (!availability.available) return { status: 503, data: { reason: 'voice-lab-unavailable', ...availability } };
    if (body.consent !== true || !['3-4', '4-5', '5-6'].includes(body.ageBand)) return { status: 400, data: { reason: 'invalid-lab-consent-or-age' } };
    if (starting || sessions.size) return { status: 429, data: { reason: 'voice-lab-busy' } };
    starting = true;
    const settings = config(), id = `voice-lab-${randomUUID()}`, identity = `tester-${randomUUID()}`, stopToken = randomUUID();
    const { rooms, dispatch } = clients(settings);
    try {
      await rooms.createRoom({ name: id, emptyTimeout: 10, departureTimeout: 5, maxParticipants: 2 });
      await dispatch.createDispatch(id, 'xiaoyu-voice-lab', { metadata: JSON.stringify({ sessionId: id, identity, ageBand: body.ageBand }) });
      const token = new AccessToken(settings.apiKey, settings.apiSecret, { identity, ttl: '5m' });
      token.addGrant({ roomJoin: true, room: id, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: [TrackSource.MICROPHONE] });
      const jwt = await token.toJwt();
      const timer = setTimeout(() => { void remove(id).catch(() => {}); }, 300000);
      timer.unref?.();
      sessions.set(id, { rooms, stopToken, timer });
      return { status: 200, data: { sessionId: id, identity, stopToken, url: settings.url, token: jwt, provider: settings.provider } };
    } catch {
      await rooms.deleteRoom(id).catch(() => {});
      return { status: 503, data: { reason: 'voice-lab-connect-failed' } };
    } finally { starting = false; }
  }
  async function remove(id) {
    const current = sessions.get(id);
    if (!current) return;
    // Keep the slot occupied if server-side teardown fails; timeout can try again.
    await current.rooms.deleteRoom(id).catch(error => { if (error.code !== 'not_found') throw error; });
    clearTimeout(current.timer); sessions.delete(id);
  }
  async function stop(body) {
    const current = sessions.get(body.sessionId);
    if (!current) return { status: 200, data: { stopped: true } };
    const received = Buffer.from(String(body.stopToken || '')), expected = Buffer.from(current.stopToken);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return { status: 403, data: { reason: 'invalid-stop-token' } };
    try { await remove(body.sessionId); return { status: 200, data: { stopped: true } }; }
    catch { return { status: 503, data: { reason: 'voice-lab-stop-unconfirmed' } }; }
  }
  return { status, start, stop };
}
