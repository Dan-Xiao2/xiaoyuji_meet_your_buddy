import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const speech = (await readFile(process.env.VOICE_LAB_SPEECH_WAV || '/private/tmp/xiaoyu-voice-lab-speech.wav')).toString('base64');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errors = [];
await context.addInitScript(speech => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    if (!constraints.audio) return original(constraints);
    window.microphoneRequests = (window.microphoneRequests || 0) + 1;
    const audio = new AudioContext({ sampleRate: 48000 }); await audio.resume();
    const dest = audio.createMediaStreamDestination();
    const buffer = await audio.decodeAudioData(Uint8Array.from(atob(speech), c => c.charCodeAt(0)).buffer);
    window.feedSpeech = async () => {
      await audio.resume(); const source = audio.createBufferSource(); source.buffer = buffer; source.connect(dest); source.start();
      return new Promise(resolve => { source.onended = resolve; });
    };
    window.testMicrophoneTrack = dest.stream.getAudioTracks()[0];
    return dest.stream;
  };
}, speech);
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4217/voice-lab.html');
  await page.waitForFunction(() => document.querySelector('#mode').textContent.includes('合成测试模式'));
  await page.locator('#consent').check(); await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#state').textContent === '小宇在听', null, { timeout: 45000 });
  await page.waitForFunction(() => typeof window.feedSpeech === 'function' && window.testMicrophoneTrack.readyState === 'live');
  console.log('PASS real LiveKit room, named Agent dispatch, browser microphone publication and agent-ready');
  // A generated synthetic speech waveform is sent through a real browser WebRTC track.
  await page.evaluate(() => { void window.feedSpeech(); });
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('生成'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#state').textContent.includes('小宇正在说'), null, { timeout: 15000 });
  assert.equal(await page.locator('#audio audio').count(), 1);
  await page.evaluate(() => {
    const audio = new AudioContext(); const source = audio.createMediaStreamSource(document.querySelector('#audio audio').srcObject);
    const analyser = audio.createAnalyser(); source.connect(analyser);
    window.remoteEnergy = () => { const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values); return Math.max(...values.map(Math.abs)); };
  });
  await page.waitForFunction(() => window.remoteEnergy() > 0.01);
  console.log('PASS microphone waveform -> local VAD -> synthetic STT -> LLM hook -> PCM -> real received WebRTC audio track');
  // Speak over active audio, without pressing the explicit interrupt button.
  await page.evaluate(() => { void window.feedSpeech(); });
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('本段被打断'), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#events li').length >= 4 && [...document.querySelectorAll('#events li')].filter(el => el.textContent.startsWith('生成')).length >= 2, null, { timeout: 30000 });
  console.log('PASS actual overlapping speech interrupts the first SDK speech and a second answer is generated');
  await page.waitForFunction(() => document.querySelector('#state').textContent.includes('小宇正在说'));
  await page.waitForFunction(() => window.remoteEnergy() > 0.01);
  await page.locator('#interrupt').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#events li')].filter(el => el.textContent.includes('本段被打断')).length >= 2, null, { timeout: 15000 });
  await page.waitForFunction(() => window.remoteEnergy() < 0.001);
  const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(bodyWidth <= 390);
  const output = process.env.VOICE_LAB_SCREENSHOTS || 'screenshots'; await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/voice-lab-390.png`, fullPage: true });
  await page.locator('#stop').click();
  await page.waitForFunction(() => window.testMicrophoneTrack.readyState === 'ended');
  assert.equal(await page.locator('#audio audio').count(), 0);
  const countAfterStop = await page.locator('#events li').count();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#events li').count(), countAfterStop);
  assert.deepEqual(errors, []);
  console.log('PASS explicit stop ends microphone/output, rejects late events, and 390px layout remains contained');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${output}/voice-lab-1440.png`, fullPage: true });
  const microphoneRequests = await page.evaluate(() => window.microphoneRequests);
  let release, markCreated;
  const gate = new Promise(resolve => { release = resolve; });
  const created = new Promise(resolve => { markCreated = resolve; });
  await page.route('**/api/voice-lab/start', async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    const credentials = await response.json(); markCreated(credentials.sessionId);
    await gate; await route.fulfill({ response });
  });
  await page.locator('#start').click();
  const pendingId = await created;
  await page.locator('#stop').click();
  const cleanup = page.waitForResponse(response => response.url().endsWith('/api/voice-lab/stop') && response.request().postDataJSON().sessionId === pendingId);
  release();
  assert.equal((await cleanup).status(), 200);
  await page.waitForFunction(() => !document.querySelector('#start').disabled);
  assert.equal(await page.evaluate(() => window.microphoneRequests), microphoneRequests);
  assert.equal(await page.locator('#audio audio').count(), 0);
  console.log('PASS cancelling bootstrap releases a real late-created room without reopening the microphone');
} catch (error) {
  console.error('LAB FAILURE STATE', await page.evaluate(() => ({ state: document.querySelector('#state').textContent, events: document.querySelector('#events').textContent, error: document.querySelector('#error').textContent })));
  throw error;
} finally { await page.evaluate(() => document.querySelector('#stop')?.click()).catch(() => {}); await context.close(); await browser.close(); }
