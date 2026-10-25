// Opt-in paid probe with one synthetic phrase. Never reads microphone or family records.
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { loadLocalEnv } from "../server/env.mjs";
import { synthesizeSpeech, transcribeAudio } from "../server/qwenSpeech.mjs";
import { attachRealtimeAsr } from "../server/realtimeAsr.mjs";

if (!process.argv.includes("--live")) throw new Error("Use --live to authorize one synthetic TTS, realtime ASR and batch ASR request.");
loadLocalEnv(process.cwd());
const phrase = "请画一个房子，把屋顶改成蓝色。";
const speech = await synthesizeSpeech(phrase);
if (!speech.ok) throw new Error(`Synthetic TTS failed (${speech.status})`);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
let pcm;
try {
  const page = await browser.newPage();
  pcm = Buffer.from(await page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), x => x.charCodeAt(0));
    const context = new OfflineAudioContext(1, 1, 16000);
    const audio = await context.decodeAudioData(bytes.buffer);
    const samples = audio.getChannelData(0), buffer = new ArrayBuffer(samples.length * 2), view = new DataView(buffer);
    for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
    return [...new Uint8Array(buffer)];
  }, speech.audio.toString("base64")));
} finally { await browser.close(); }
const server = createServer();
const relay = attachRealtimeAsr(server);
server.listen(0, "127.0.0.1"); await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const ws = new WebSocket(origin.replace("http", "ws") + "/api/asr/realtime", { origin });
let finalSentAt = 0, firstSentAt = 0, readyAt = 0;
const openedAt = performance.now();
try {
  const realtime = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Probe timeout")), 35000);
    ws.on("error", () => { clearTimeout(timer); reject(new Error("Probe connection failed")); });
    ws.on("message", async raw => {
      const event = JSON.parse(String(raw));
      if (event.type === "ready") {
        readyAt = performance.now(); firstSentAt = readyAt;
        for (let i = 0; i < pcm.length && ws.readyState === WebSocket.OPEN; i += 3200) {
          ws.send(pcm.subarray(i, i + 3200));
          await delay(Math.min(3200, pcm.length - i) / 32);
        }
        finalSentAt = performance.now();
        if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"finish"}');
      } else if (event.type === "final") {
        clearTimeout(timer);
        resolve({ matched: normalize(event.text) === normalize(phrase), connectMs: Math.round(readyAt - openedAt), afterFinishMs: Math.round(performance.now() - finalSentAt), streamTotalMs: Math.round(performance.now() - firstSentAt) });
      } else if (event.type === "error") { clearTimeout(timer); reject(new Error(`Realtime failed: ${event.code}`)); }
    });
  });
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  const started = performance.now();
  const batch = await transcribeAudio({ audioBase64: wav.toString("base64"), mimeType: "audio/wav" });
  console.log(JSON.stringify({ synthetic: true, samples: 1, audioSeconds: pcm.length / 32000, realtime, batch: { ok: batch.ok, matched: normalize(batch.text) === normalize(phrase), afterFinishMs: Math.round(performance.now() - started) }, excludes: "microphone, endpoint silence, LLM, TTS playback; not a child-speech benchmark" }, null, 2));
} finally {
  ws.terminate(); for (const client of relay.clients) client.terminate(); relay.close();
  await new Promise(resolve => server.close(resolve));
}
function normalize(text = "") { return text.replace(/[\p{P}\s]/gu, ""); }
