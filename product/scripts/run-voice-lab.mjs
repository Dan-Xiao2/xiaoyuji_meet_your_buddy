import { spawn } from 'node:child_process';
import { loadLocalEnv } from '../server/env.mjs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
loadLocalEnv(root);
const live = process.argv.includes('--live');
const env = { ...process.env, HOST: '127.0.0.1', PORT: process.env.VOICE_LAB_PORT || '4217',
  LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret',
  VOICE_LAB_ENABLED: 'true', VOICE_LAB_PROVIDER: live ? 'qwen' : 'synthetic',
  ...(live ? {} : { TUTOR_ENABLE_LLM: 'false', IMAGE_DRAWING_ENABLED: 'false' }) };
await build({ entryPoints: ['src/voice-lab/page.js'], bundle: true, format: 'esm', outfile: 'src/voice-lab/client.bundle.js', target: 'es2022', minify: true });
const children = [];
let closing = false;
function close() { if (closing) return; closing = true; for (const child of children.reverse()) child.kill('SIGTERM'); }
function run(cmd, args) {
  const child = spawn(cmd, args, { cwd: root, env, stdio: 'inherit' }); children.push(child);
  child.on('error', () => { console.error('无法启动实验进程，请检查LiveKit服务路径和依赖。'); close(); process.exitCode = 1; });
  child.on('exit', code => { if (!closing) { process.exitCode = code || 1; close(); } });
  return child;
}
process.on('SIGINT', close); process.on('SIGTERM', close);
run(process.env.LIVEKIT_SERVER_BIN || 'livekit-server', ['--dev', '--bind', '127.0.0.1', '--node-ip', '127.0.0.1']);
await new Promise(resolve => setTimeout(resolve, 1000));
if (!closing) {
  run(process.execPath, ['voice-agent/agent.mjs', 'dev', '--log-level', 'warn']);
  run(process.execPath, ['server/server.mjs']);
  console.log(`语音实验: http://127.0.0.1:${env.PORT}/voice-lab.html (${live ? '真实服务' : '合成测试，无模型调用'})`);
}
