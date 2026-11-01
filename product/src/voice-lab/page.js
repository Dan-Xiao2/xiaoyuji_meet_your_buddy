import { createLivekitVoiceClient } from '../services/livekitVoiceClient.js';
const node = id => document.getElementById(id);
let available = false, active = false, busy = false, canSend = false, provider = 'unknown';
const states = { connecting: '正在连接…', 'waiting-agent': '等待小宇准备好…', initializing: '小宇正在准备…',
  listening: '小宇在听', thinking: '小宇正在想', speaking: '小宇正在说，可以开口打断',
  reconnecting: '连接中断，正在重连…', stopped: '聊天已结束', failed: '连接失败，请检查实验服务后重试',
  'audio-blocked': '声音未能播放，请结束后重新开始' };
function buttons() {
  node('start').disabled = !available || busy || active || !node('consent').checked;
  node('stop').disabled = !active && !busy;
  node('interrupt').disabled = !active;
  node('send').disabled = !canSend;
  node('age').disabled = active || busy;
}
// Timing trace for latency checks: event type, stage and clock times only, never text or audio.
const trace = window.voiceLabTrace = [];
function event(event) {
  trace.push({ type: event.type, stage: event.stage, state: event.state, interrupted: event.interrupted, at: event.at, receivedAt: Date.now() });
  if (trace.length > 200) trace.shift();
  if (event.type === 'mode') provider = event.provider;
  if (event.type === 'stop-unconfirmed') {
    node('error').hidden = false; node('error').textContent = '本机音频已停止，远端结束尚未确认；请检查实验服务。';
  }
  const labels = { transcript: '输入', generated: provider === 'synthetic' ? '生成（合成）' : event.modelUsed ? '生成（模型）' : '生成（本地规则或备用）', playout: event.interrupted ? '打断后的SDK估算' : 'SDK播放记录',
    'speech-ended': event.interrupted ? '本段被打断' : '本段播放结束', failure: '服务失败' };
  if (!labels[event.type]) return;
  const item = document.createElement('li');
  item.textContent = `${labels[event.type]}${event.text ? `：${event.text}` : ''}`;
  node('events').append(item);
  while (node('events').children.length > 60) node('events').firstElementChild.remove();
}
const client = createLivekitVoiceClient({ audioContainer: node('audio'), onEvent: event, onState: state => {
  node('state').textContent = states[state] || state;
  active = !['stopped', 'failed'].includes(state);
  canSend = ['listening', 'thinking', 'speaking'].includes(state);
  buttons();
} });
node('consent').addEventListener('change', buttons);
node('start').addEventListener('click', async () => {
  busy = true; buttons(); node('error').hidden = true;
  try { await client.start({ ageBand: node('age').value, consent: node('consent').checked }); }
  catch { node('error').hidden = false; node('error').textContent = '没能接通语音。麦克风权限、LiveKit服务和Agent都需要就绪。'; }
  finally { busy = false; buttons(); }
});
node('stop').addEventListener('click', () => { void client.stop(); });
node('interrupt').addEventListener('click', () => { void client.interrupt().catch(() => client.stop()); });
node('textForm').addEventListener('submit', async e => {
  e.preventDefault(); const text = node('text').value.trim(); if (!text) return;
  try { await client.sendText(text); node('text').value = ''; }
  catch { node('error').hidden = false; node('error').textContent = '文字未送达，请检查连接。'; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) void client.stop(); });
window.addEventListener('pagehide', () => { void client.stop(); });
fetch('/api/voice-lab/status').then(r => r.json()).then(status => {
  available = status.available;
  node('mode').textContent = !status.enabled ? '实验服务尚未启用。' : !available ? '实验服务配置尚未完成。'
    : status.provider === 'synthetic' ? '合成测试模式：只验证连接、语音活动和停止，不识别真实话语。' : '中文语音实验：音频将发送至已配置的ASR服务。';
  buttons();
}).catch(() => { node('mode').textContent = '暂时无法检查实验服务。'; });
