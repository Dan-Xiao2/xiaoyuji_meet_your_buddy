import { createParser } from "eventsource-parser";
import { deriveDashScopeServiceUrl, getSpeechStatus } from "./qwenSpeech.mjs";

export async function* decodeSpeechEvents(body) {
  const queue = [];
  let failure = null;
  let completed = false;
  let totalBytes = 0;
  const decoder = new TextDecoder();
  const parser = createParser({
    maxBufferSize: 4 * 1024 * 1024,
    onError: (error) => { if (error.type === "max-buffer-size-exceeded") failure = error; },
    onEvent: ({ data }) => {
      if (data === "[DONE]") { completed = true; return; }
      try {
        const event = JSON.parse(data);
        if (event.code || event.error) throw new Error("Speech provider rejected the stream");
        const audio = event.output?.audio?.data;
        if (audio) {
          if (typeof audio !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio)) throw new Error("Invalid audio data");
          const bytes = Buffer.from(audio, "base64");
          totalBytes += bytes.length;
          if (totalBytes > 12 * 1024 * 1024) throw new Error("Speech exceeds size limit");
          if (bytes.length) queue.push(bytes);
        }
        if (event.output?.finish_reason === "stop") completed = true;
      } catch (error) { failure = error; }
    }
  });
  for await (const chunk of body) {
    parser.feed(decoder.decode(chunk, { stream: true }));
    if (failure) throw failure;
    while (queue.length) yield queue.shift();
  }
  parser.feed(decoder.decode());
  if (failure) throw failure;
  while (queue.length) yield queue.shift();
  if (!totalBytes || !completed) throw new Error("Speech stream ended before completion");
}

export async function openSpeechStream(text, signal) {
  const status = getSpeechStatus().tts;
  if (status.provider !== "qwen" || !status.configured || process.env.TTS_STREAMING === "false") throw new Error("Streaming speech is unavailable");
  const cleanText = String(text || "").trim().slice(0, 600);
  if (!cleanText) throw new Error("No text supplied");
  const timeoutMs = Number(process.env.TTS_TIMEOUT_MS) || 18000;
  const deadline = AbortSignal.timeout(Math.max(1000, timeoutMs));
  const combinedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const response = await fetch(deriveDashScopeServiceUrl(process.env.QWEN_BASE_URL, "/api/v1/services/audio/tts/SpeechSynthesizer"), {
    method: "POST", signal: combinedSignal,
    headers: { Authorization: `Bearer ${process.env.QWEN_API_KEY}`, "Content-Type": "application/json", "X-DashScope-SSE": "enable" },
    body: JSON.stringify({ model: status.model, input: {
      text: cleanText, voice: status.voice, format: "pcm", sample_rate: 24000, volume: 55,
      rate: Math.max(0.5, Math.min(2, Number(process.env.TTS_SPEAKING_RATE) || 0.88)),
      pitch: 1.04, language_hints: ["zh"]
    } })
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
    await response.body?.cancel();
    throw new Error("Streaming speech request failed");
  }
  return decodeSpeechEvents(response.body);
}
