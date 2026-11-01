import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { join } from 'node:path';
const live = process.argv.includes('--live');
if (live && !process.env.VOICE_LAB_SPEECH_WAV) throw new Error('Live checks require an explicit synthetic Chinese VOICE_LAB_SPEECH_WAV');
const output = process.env.VOICE_LAB_REPORT_DIR || 'reports/voice-lab';
mkdirSync(output, { recursive: true });
const speech = process.env.VOICE_LAB_SPEECH_WAV || '/private/tmp/xiaoyu-voice-lab-speech.wav';
async function command(executable, args, env = process.env, log) {
  const child = spawn(executable, args, { env, stdio: log ? ['ignore', log, log] : 'inherit' });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (code !== 0) throw new Error(`${executable} exited ${code}`);
}
if (!existsSync(speech)) {
  if (process.platform !== 'darwin') throw new Error('Set VOICE_LAB_SPEECH_WAV to a synthetic speech WAV');
  await command('/usr/bin/say', ['-o', '/private/tmp/xiaoyu-voice-lab-speech.aiff', 'Hello, I have a question about the blue sky. Could you please listen to my question?']);
  await command('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', '/private/tmp/xiaoyu-voice-lab-speech.aiff', speech]);
}
const env = { ...process.env, VOICE_LAB_SPEECH_WAV: speech,
  TEST_URL: `http://127.0.0.1:${process.env.VOICE_LAB_PORT || 4217}/voice-lab.html`,
  VOICE_LAB_SCREENSHOTS: output };
const log = createWriteStream(join(output, 'services.log'));
const runner = spawn(process.execPath, ['scripts/run-voice-lab.mjs', ...(live ? ['--live'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
runner.stdout.pipe(log); runner.stderr.pipe(log);
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (runner.exitCode !== null) throw new Error('Voice lab failed to start');
    try {
      const response = await fetch(env.TEST_URL.replace('/voice-lab.html', '/api/voice-lab/status'));
      const health = await fetch(`http://127.0.0.1:${process.env.VOICE_AGENT_PORT || 8087}/`);
      if (response.ok && health.ok) break;
    } catch {}
    if (attempt === 99) throw new Error('Voice lab startup timed out');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await command(process.execPath, [live ? 'tests/livekit-live-browser.mjs' : 'tests/livekit-loop-browser.mjs'], env);
} finally {
  runner.kill('SIGTERM');
  await new Promise(resolve => { if (runner.exitCode !== null) resolve(); else runner.once('exit', resolve); });
  log.end();
}
