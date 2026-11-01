import { Room, RoomEvent, Track, ParticipantKind } from 'livekit-client';

export function createLivekitVoiceClient({ audioContainer, onEvent = () => {}, onState = () => {}, createRoom = options => new Room(options) }) {
  let revision = 0, room = null, credentials = null;
  let starting = false, lastSequence = 0, readinessTimer = null;
  // True only after the agent proves that microphone audio reached its recogniser. A bare
  // "ready" or a state event is not proof, and a dropped connection invalidates it.
  let inputReady = false;
  // Each hello carries a new id; only a ready that answers the latest hello counts, so a ready
  // sent before a reconnect and delivered after it cannot restore "listening".
  let helloId = 0, expectedHello = null;
  // stop() bumps the revision synchronously, then awaits remote cleanup. A new session may start
  // meanwhile, so "failed" is shown only if no other session began after this one ended.
  const failAfterStop = () => {
    const stopping = stop(), ended = revision;
    return stopping.then(() => { if (revision === ended) onState('failed'); });
  };
  const armReadiness = (live) => {
    clearTimeout(readinessTimer);
    readinessTimer = setTimeout(() => { if (live()) void failAfterStop(); }, 20000);
  };
  const hello = () => {
    expectedHello = ++helloId;
    return control('hello', undefined, { helloId: expectedHello });
  };
  const post = async (path, body, keepalive = false) => {
    const response = await fetch(`/api/voice-lab/${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive });
    const data = await response.json();
    if (!response.ok) throw new Error(data.reason || 'voice-lab-request-failed');
    return data;
  };
  function clearAudio() {
    for (const element of audioContainer.querySelectorAll('audio')) { element.pause(); element.srcObject = null; element.remove(); }
  }
  async function release(current) {
    if (!current) return;
    try { await post('stop', { sessionId: current.sessionId, stopToken: current.stopToken }, true); }
    catch { onEvent({ type: 'stop-unconfirmed' }); }
  }
  async function stop() {
    revision++;
    clearTimeout(readinessTimer); readinessTimer = null;
    inputReady = false; expectedHello = null;
    const previous = room, previousCredentials = credentials;
    room = null; credentials = null;
    clearAudio();
    // Disconnect immediately; remote cleanup must not delay local microphone/output shutdown.
    const disconnecting = previous?.disconnect(true);
    onState('stopped');
    await Promise.allSettled([disconnecting, release(previousCredentials)]);
  }
  async function start({ ageBand, consent }) {
    if (starting || room) return;
    starting = true;
    const generation = ++revision;
    let ownedCredentials = null, microphoneReady = false;
    inputReady = false;
    const current = createRoom({ adaptiveStream: false, dynacast: false,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    room = current; lastSequence = 0;
    const live = () => generation === revision && room === current;
    onState('connecting');
    void current.startAudio().catch(() => {});
    current.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (!live() || participant.kind !== ParticipantKind.AGENT || track.kind !== Track.Kind.Audio) return;
      const element = track.attach(); audioContainer.append(element);
      element.play().catch(() => { if (live()) onState('audio-blocked'); });
      onEvent({ type: 'audio-track' });
    });
    current.on(RoomEvent.DataReceived, (bytes, participant, kind, topic) => {
      if (!live() || participant?.kind !== ParticipantKind.AGENT || topic !== 'xiaoyu.voice-lab' || bytes.length > 20000) return;
      try {
        const event = JSON.parse(new TextDecoder().decode(bytes));
        if (event.sessionId !== ownedCredentials?.sessionId || !Number.isInteger(event.seq) || event.seq <= lastSequence) return;
        lastSequence = event.seq;
        onEvent(event);
        if (event.type === 'ready' && event.inputReady === true && expectedHello !== null && event.helloId === expectedHello) {
          clearTimeout(readinessTimer); readinessTimer = null; inputReady = true;
          if (microphoneReady) onState(event.state || 'listening');
        }
        // Before input is proven (or while reconnecting) agent state must not reach the display.
        if (event.type === 'state' && microphoneReady && inputReady) onState(event.state);
        if (event.type === 'ended' || event.type === 'failure') void stop();
      } catch { /* Ignore invalid remote data. */ }
    });
    current.on(RoomEvent.ParticipantConnected, participant => {
      if (!live() || !microphoneReady || participant.kind !== ParticipantKind.AGENT) return;
      // A (re)joined agent has not yet received this microphone: proof must be given again.
      if (inputReady) onState('waiting-agent');
      inputReady = false; armReadiness(live);
      void hello().catch(() => {});
    });
    // After a reconnect the agent must answer the new hello again before the page shows listening.
    current.on(RoomEvent.Reconnected, () => { if (live()) { inputReady = false; armReadiness(live); void hello().catch(() => {}); } });
    current.on(RoomEvent.Reconnecting, () => { if (live()) { inputReady = false; onState('reconnecting'); } });
    current.on(RoomEvent.Disconnected, () => { if (live()) void stop(); });
    try {
      ownedCredentials = await post('start', { ageBand, consent });
      if (!live()) { await release(ownedCredentials); return; }
      credentials = ownedCredentials;
      onEvent({ type: 'mode', provider: credentials.provider });
      await current.connect(credentials.url, credentials.token);
      if (!live()) { await current.disconnect(true); return; }
      await current.localParticipant.setMicrophoneEnabled(true);
      if (!live()) { await current.disconnect(true); return; }
      microphoneReady = true;
      await hello();
      if (!live()) return;
      if (!inputReady) armReadiness(live);
      onState(inputReady ? 'listening' : 'waiting-agent');
    } catch (error) {
      if (live()) { await failAfterStop(); throw error; }
    } finally { starting = false; }
  }
  async function control(type, text, extra = {}) {
    if (!room || !credentials) return;
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({
      type, text, sessionId: credentials.sessionId, ...extra
    })), { reliable: true, topic: 'xiaoyu.voice-lab.control' });
  }
  async function sendText(text) {
    if (!inputReady) throw new Error('voice-lab not ready');
    await control('text', text);
  }
  return { start, stop, interrupt: () => control('interrupt'), sendText };
}
