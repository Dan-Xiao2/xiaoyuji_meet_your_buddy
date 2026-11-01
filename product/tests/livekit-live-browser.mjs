// Opt-in real-provider integration. Use only synthetic audio under an approved budget.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const speech = (await readFile(process.env.VOICE_LAB_SPEECH_WAV)).toString('base64');
const output = process.env.VOICE_LAB_REPORT_DIR || 'reports/voice-lab-live';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(speech => {
  navigator.mediaDevices.getUserMedia = async constraints => {
    if (!constraints.audio) throw new Error('Audio-only experiment');
    const audio = new AudioContext({ sampleRate: 48000 }); await audio.resume();
    const destination = audio.createMediaStreamDestination();
    const buffer = await audio.decodeAudioData(Uint8Array.from(atob(speech), c => c.charCodeAt(0)).buffer);
    window.feedSpeech = () => { const source = audio.createBufferSource(); source.buffer = buffer; source.connect(destination); source.start(); };
    window.testMicrophoneTrack = destination.stream.getAudioTracks()[0];
    return destination.stream;
  };
}, speech);
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const report = { syntheticInput: true, realProviders: true, budgetCeilingCny: 10, transport: 'real local LiveKit WebRTC', timings: {}, stages: [] };
try {
  await page.goto(process.env.TEST_URL);
  await page.waitForFunction(() => document.querySelector('#mode').textContent.includes('中文语音实验'));
  await page.locator('#consent').check(); await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#state').textContent === '小宇在听' && window.testMicrophoneTrack?.readyState === 'live', null, { timeout: 45000 });
  const inputAt = performance.now();
  await page.evaluate(() => window.feedSpeech());
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('输入：'), null, { timeout: 15000 });
  report.timings.inputStartToTranscriptMs = Math.round(performance.now() - inputAt);
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('生成（模型）'), null, { timeout: 12000 });
  report.timings.inputStartToGeneratedMs = Math.round(performance.now() - inputAt);
  await page.waitForFunction(() => document.querySelector('#state').textContent.includes('小宇正在说'), null, { timeout: 15000 });
  await page.evaluate(() => {
    const audio = new AudioContext(); const source = audio.createMediaStreamSource(document.querySelector('#audio audio').srcObject);
    const analyser = audio.createAnalyser(); source.connect(analyser);
    window.remoteEnergy = () => { const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values); return Math.max(...values.map(Math.abs)); };
  });
  await page.waitForFunction(() => window.remoteEnergy() > 0.01);
  report.timings.inputStartToReceivedAudioMs = Math.round(performance.now() - inputAt);
  report.stages.push('Real ASR transcript, real LLM reply and nonzero TTS audio received through WebRTC');
  console.log('PASS real Qwen ASR -> real LLM (no fallback) -> real TTS -> received WebRTC audio');
  await page.locator('details').evaluate(element => { element.open = true; });
  await page.screenshot({ path: `${output}/live-390.png`, fullPage: true });
  const interruptAt = performance.now();
  await page.evaluate(() => window.feedSpeech());
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('本段被打断'), null, { timeout: 10000 });
  await page.waitForFunction(() => window.remoteEnergy() < 0.001);
  report.timings.interruptionInputStartToSilenceMs = Math.round(performance.now() - interruptAt);
  report.stages.push('Overlapping synthetic speech interrupts actual provider audio');
  report.events = await page.locator('#events li').allTextContents();
  await page.locator('#stop').click();
  await page.waitForFunction(() => window.testMicrophoneTrack.readyState === 'ended');
  assert.equal(await page.locator('#audio audio').count(), 0);
  await page.waitForTimeout(800);
  assert.equal((await page.locator('#events li').allTextContents()).filter(text => text.startsWith('生成（模型）')).length, 1);
  assert.deepEqual(errors, []);
  report.stages.push('Explicit stop ends microphone and output before a second model answer');
  report.status = 'passed';
  console.log('PASS real-provider audio is interrupted and the session closes without reopening output');
} catch (error) {
  report.status = 'failed'; report.error = error.message;
  report.ui = await page.evaluate(() => ({ state: document.querySelector('#state').textContent, events: document.querySelector('#events').textContent }));
  throw error;
} finally {
  await page.evaluate(() => document.querySelector('#stop')?.click()).catch(() => {});
  await writeFile(`${output}/receipt.json`, JSON.stringify(report, null, 2));
  await context.close(); await browser.close();
}
