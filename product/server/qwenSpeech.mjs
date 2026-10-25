const DEFAULT_COMPATIBLE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_ASR_MODEL = "qwen3-asr-flash";
const DEFAULT_TTS_MODEL = "qwen-audio-3.0-tts-flash";
const DEFAULT_TTS_VOICE = "longanhuan_v3.6";

export function getSpeechStatus() {
  const qwenConfigured = hasUsableKey(process.env.QWEN_API_KEY);
  const asrProvider = process.env.ASR_PROVIDER || "qwen";
  const ttsProvider = process.env.TTS_PROVIDER || "browser";
  const cloudTtsEnabled = process.env.USE_CLOUD_TTS === "true" && ttsProvider === "qwen";

  return {
    asr: {
      provider: asrProvider,
      configured: asrProvider === "qwen" ? qwenConfigured : hasUsableKey(process.env.OPENAI_API_KEY),
      model: asrProvider === "qwen" ? process.env.QWEN_ASR_MODEL || DEFAULT_ASR_MODEL : process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe"
    },
    tts: {
      provider: cloudTtsEnabled ? "qwen" : "browser",
      configured: cloudTtsEnabled ? qwenConfigured : true,
      model: cloudTtsEnabled ? process.env.QWEN_TTS_MODEL || DEFAULT_TTS_MODEL : "browser-speech-synthesis",
      voice: cloudTtsEnabled ? process.env.QWEN_TTS_VOICE || DEFAULT_TTS_VOICE : "browser-default"
    }
  };
}

export async function transcribeAudio(body = {}) {
  const provider = process.env.ASR_PROVIDER || "qwen";
  if (provider === "qwen") return transcribeWithQwen(body);
  if (provider === "openai") return transcribeWithOpenAi(body);
  return failure(400, `Unsupported ASR provider: ${provider}`);
}

export async function synthesizeSpeech(text) {
  const startedAt = Date.now();
  const provider = process.env.TTS_PROVIDER || "browser";
  if (process.env.USE_CLOUD_TTS !== "true" || provider !== "qwen") {
    return failure(501, "Cloud TTS is disabled; use browser speech synthesis.");
  }
  if (!hasUsableKey(process.env.QWEN_API_KEY)) {
    return failure(501, "Qwen API key is not configured for speech synthesis.");
  }

  const cleanText = String(text || "").trim().slice(0, 600);
  if (!cleanText) return failure(400, "No text was provided for speech synthesis.");

  const model = process.env.QWEN_TTS_MODEL || DEFAULT_TTS_MODEL;
  const voice = process.env.QWEN_TTS_VOICE || DEFAULT_TTS_VOICE;
  const endpoint = deriveDashScopeServiceUrl(process.env.QWEN_BASE_URL, "/api/v1/services/audio/tts/SpeechSynthesizer");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), numberFromEnv("TTS_TIMEOUT_MS", 18000));

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.QWEN_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: {
          text: cleanText,
          voice,
          format: "mp3",
          sample_rate: 24000,
          volume: 55,
          rate: clamp(numberFromEnv("TTS_SPEAKING_RATE", 0.88), 0.5, 2),
          pitch: 1.04,
          language_hints: ["zh"]
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return failure(response.status, apiError(data, "Qwen TTS request failed."));

    const audioUrl = data.output?.audio?.url;
    if (!audioUrl) return failure(502, "Qwen TTS returned no audio URL.");
    const audioResponse = await fetch(audioUrl, { signal: controller.signal });
    if (!audioResponse.ok) return failure(audioResponse.status, "Generated speech audio could not be downloaded.");

    return {
      ok: true,
      status: 200,
      provider: "qwen",
      model,
      requestId: data.request_id || "",
      characters: data.usage?.characters || cleanText.length,
      latencyMs: Date.now() - startedAt,
      contentType: audioResponse.headers.get("content-type") || "audio/mpeg",
      audio: Buffer.from(await audioResponse.arrayBuffer())
    };
  } catch (error) {
    return failure(502, error.name === "AbortError" ? "Qwen TTS timed out." : "Could not connect to Qwen TTS.");
  } finally {
    clearTimeout(timeout);
  }
}

async function transcribeWithQwen(body) {
  const startedAt = Date.now();
  if (!hasUsableKey(process.env.QWEN_API_KEY)) return failure(501, "Qwen API key is not configured for speech recognition.");
  if (!body.audioBase64) return failure(400, "No recorded audio was received.");

  const model = process.env.QWEN_ASR_MODEL || DEFAULT_ASR_MODEL;
  const baseUrl = trimTrailingSlash(process.env.QWEN_BASE_URL || DEFAULT_COMPATIBLE_BASE_URL);
  const mimeType = normalizeAudioMimeType(body.mimeType);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), numberFromEnv("ASR_TIMEOUT_MS", 18000));

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.QWEN_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: { data: `data:${mimeType};base64,${body.audioBase64}` }
              }
            ]
          }
        ],
        stream: false,
        asr_options: {
          language: voiceLanguageCode(),
          enable_itn: true
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return failure(response.status, apiError(data, "Qwen ASR request failed."));

    const text = String(data.choices?.[0]?.message?.content || "").trim();
    if (!text) return failure(502, "Qwen ASR returned an empty transcript.");
    return {
      ok: true,
      status: 200,
      provider: "qwen",
      model,
      text,
      latencyMs: Date.now() - startedAt,
      message: "语音已转成文字。"
    };
  } catch (error) {
    return failure(502, error.name === "AbortError" ? "Qwen ASR timed out." : "Could not connect to Qwen ASR.");
  } finally {
    clearTimeout(timeout);
  }
}

async function transcribeWithOpenAi(body) {
  if (!hasUsableKey(process.env.OPENAI_API_KEY)) return failure(501, "OpenAI API key is not configured for speech recognition.");
  if (!body.audioBase64) return failure(400, "No recorded audio was received.");

  const mimeType = normalizeAudioMimeType(body.mimeType);
  const extension = mimeType.includes("mp4") ? "mp4" : "webm";
  const formData = new FormData();
  formData.append("file", new Blob([Buffer.from(body.audioBase64, "base64")], { type: mimeType }), `family-voice.${extension}`);
  formData.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  formData.append("temperature", "0");

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return failure(response.status, apiError(data, "OpenAI transcription failed."));
    return { ok: true, status: 200, provider: "openai", model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe", text: data.text || "", message: "语音已转成文字。" };
  } catch {
    return failure(502, "Could not connect to OpenAI transcription.");
  }
}

export function deriveDashScopeServiceUrl(baseUrl, servicePath) {
  const compatibleBase = trimTrailingSlash(baseUrl || DEFAULT_COMPATIBLE_BASE_URL);
  return `${compatibleBase.replace(/\/compatible-mode\/v1$/, "")}${servicePath}`;
}

function voiceLanguageCode() {
  const configured = String(process.env.VOICE_LANGUAGE || "zh-CN").toLowerCase();
  if (configured.startsWith("yue")) return "yue";
  if (configured.startsWith("en")) return "en";
  return "zh";
}

function normalizeAudioMimeType(value) {
  const mimeType = String(value || "audio/webm").split(";")[0].trim().toLowerCase();
  return ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"].includes(mimeType) ? mimeType : "audio/webm";
}

function hasUsableKey(value) {
  const key = String(value || "").trim();
  return Boolean(key && !key.startsWith("replace_me") && !key.includes("your_"));
}

function apiError(data, fallback) {
  return data.error?.message || data.message || data.output?.message || fallback;
}

function failure(status, message) {
  return { ok: false, status, text: "", message };
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
