import { createParser } from "eventsource-parser";
import { createConversationTurn as createTutorTurn } from "../src/services/tutorEngine.js";
import { adaptTutorReply, getAgeInstruction } from "../src/content/ageAdaptation.js";
import { createKnowledgeContext, selectKnowledgeCards } from "./knowledgeCardSelector.mjs";
import { checkChildSafety, checkTutorSafetyOutput, safetyInstruction, safeConversationMessages } from "../src/services/safety.js";
import { resolveVisualPlan, relevantBoard } from "../src/whiteboard/visualPlan.js";
import { drawingCapability, conversationPrinciple, drawingExecutionRule } from "../src/whiteboard/illustrationPlan.js";
import { guardDrawingReply } from "./drawingReplyGuard.mjs";
import { isLessonAnswer, isInteractionControl, conversationControlReply, explorationInstruction } from "../src/services/conversationIntent.js";
import { scienceInstruction, guardScienceReply } from "./scienceContext.mjs";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export async function createTutorTurnWithQwen(input, currentState, { signal, spokenReply } = {}) {
  signal?.throwIfAborted();
  const deliveredReply = typeof spokenReply === "string" && checkTutorSafetyOutput(spokenReply).ok ? spokenReply.slice(0, 600) : "";
  const localState = createTutorTurn(input, currentState);
  if (localState.visualPlan) return localState;
  const knowledge = selectKnowledgeCards({ input, currentState });

  // Safety redirects are deterministic and must not be replaced by a model response.
  if (localState.board?.type === "safety") {
    return {
      ...localState,
      llmStatus: {
        provider: "local",
        used: false,
        fallback: false,
        message: "安全场景由本地规则处理"
      }
    };
  }

  if (!shouldUseQwen(currentState, input)) {
    return localState;
  }

  const startedAt = Date.now();
  try {
    const llmTurn = await callQwenTutor(input, currentState, localState, knowledge, signal, deliveredReply);
    signal?.throwIfAborted();
    const grounded = guardScienceReply(llmTurn.tutorReply || "", input, currentState);
    const drawingGuard = guardDrawingReply(grounded.reply, input, currentState);
    llmTurn.tutorReply = drawingGuard.reply;
    const outputCheck = validateTutorOutput(llmTurn, { input, currentState, knowledge });
    if (!outputCheck.ok) throw new Error(`Qwen output rejected: ${outputCheck.reason}`);
    const nextState = mergeLlmTurn(localState, llmTurn, knowledge);
    if (deliveredReply) {
      nextState.messages = replaceLatestTutor(localState.messages, deliveredReply, currentState.profile?.ageBand);
      nextState.board = currentState.board || { type: "blank" };
      nextState.activeLesson = localState.activeLesson;
      nextState.offlineTask = localState.offlineTask;
    }
    nextState.llmStatus.latencyMs = Date.now() - startedAt;
    nextState.llmStatus.groundingFallback = grounded.replaced;
    nextState.llmStatus.drawingClaimFallback = drawingGuard.replaced;
    return nextState;
  } catch (error) {
    signal?.throwIfAborted();
    console.warn("Qwen tutor fallback:", error.message);
    return {
      ...localState,
      llmStatus: {
        provider: "qwen",
        used: false,
        fallback: true,
        message: error.message,
        latencyMs: Date.now() - startedAt
      }
    };
  }
}

// Decides whether a quick reply is answered locally (safety, control phrases, drawing plan,
// model disabled) or needs the model. Shared by the whole-reply and streamed paths so the
// two cannot drift apart.
function resolveQuickGate(input, currentState, fallbackReply) {
  const safety = checkChildSafety(input, currentState);
  if (!safety.ok) return { local: {
    reply: safety.reply,
    llmStatus: { provider: "local", used: false, fallback: false, latencyMs: 0 }
  } };
  const controlReply = conversationControlReply(input);
  if (controlReply) return { local: {
    reply: controlReply,
    llmStatus: { provider: "local", used: false, fallback: false, latencyMs: 0 }
  } };
  const fallback = shortText(checkTutorSafetyOutput(fallbackReply).ok ? fallbackReply || "我听到了。我们一起想一想。" : "这句话我需要再确认，不能随便给你建议。", 180);
  const visualPlan = resolveVisualPlan(input, currentState);
  if (visualPlan) return { local: { reply: visualPlan.reply, llmStatus: { provider: "local", used: false, fallback: false } } };
  const knowledge = selectKnowledgeCards({ input, currentState });
  if (!shouldUseQwen(currentState, input)) return { local: {
    reply: fallback,
    llmStatus: { provider: "local", used: false, fallback: true, latencyMs: 0 }
  } };
  return { fallback, knowledge };
}

export async function createQuickTutorReplyWithQwen(input, currentState, fallbackReply = "", { signal } = {}) {
  signal?.throwIfAborted();
  const gate = resolveQuickGate(input, currentState, fallbackReply);
  if (gate.local) return gate.local;
  const { fallback, knowledge } = gate;

  const startedAt = Date.now();
  try {
    const quickResult = await callQwenQuickReply(input, currentState, knowledge, signal);
    signal?.throwIfAborted();
    const grounded = guardScienceReply(quickResult.reply, input, currentState);
    const drawingGuard = guardDrawingReply(grounded.reply, input, currentState);
    const reply = drawingGuard.reply;
    if (!checkTutorSafetyOutput(reply).ok) throw new Error("Quick reply rejected by safety rules");
    return {
      reply: adaptTutorReply(reply, currentState.profile?.ageBand),
      llmStatus: {
        provider: "qwen",
        model: process.env.QWEN_MODEL || "qwen3.7-flash",
        used: true,
        fallback: false,
        latencyMs: Date.now() - startedAt,
        tokenUsage: quickResult.tokenUsage,
        knowledgeCardIds: knowledge.cardIds,
        knowledgeIntent: knowledge.intent,
        groundingFallback: grounded.replaced,
        drawingClaimFallback: drawingGuard.replaced
      }
    };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      reply: fallback,
      llmStatus: {
        provider: "qwen",
        used: false,
        fallback: true,
        message: error.message,
        latencyMs: Date.now() - startedAt
      }
    };
  }
}

const SENTENCE_END = /^([\s\S]*?[。！？!?]+)/u;

// Streams the quick reply one finished sentence at a time, so speech can start before the model
// has finished. Each sentence must pass the same checks as the whole-reply path, applied to the
// reply so far: output safety, known-fact and drawing-claim guards, and the age sentence limit.
//
// Trade-off: a sentence already released cannot be taken back. If a later sentence fails a check
// the reply stops there (stoppedBy says why) instead of being replaced as a whole. Only a failure
// in the first sentence can be replaced by the fallback.
//
// Yields { type: "sentence", text } items, then one { type: "done", llmStatus }. Caller
// cancellation rejects, as in createQuickTutorReplyWithQwen, and never produces a fallback.
export async function* streamQuickTutorReplyWithQwen(input, currentState, fallbackReply = "", { signal } = {}) {
  signal?.throwIfAborted();
  const gate = resolveQuickGate(input, currentState, fallbackReply);
  if (gate.local) {
    yield { type: "sentence", text: gate.local.reply };
    yield { type: "done", llmStatus: gate.local.llmStatus };
    return;
  }
  const { fallback, knowledge } = gate;
  const ageBand = currentState.profile?.ageBand;
  const startedAt = Date.now();
  const controller = new AbortController();
  const upstreamSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const firstTimeoutMs = Number(process.env.TUTOR_QUICK_TIMEOUT_MS || 3500);
  const totalTimeoutMs = Number(process.env.TUTOR_QUICK_STREAM_TIMEOUT_MS || 10000);
  let timedOut = false;
  const expire = () => { timedOut = true; controller.abort(); };
  const firstTimer = setTimeout(expire, firstTimeoutMs);
  const totalTimer = setTimeout(expire, totalTimeoutMs);
  const meta = {};
  const spoken = [];
  const pending = [];
  let buffer = "";
  let firstSentenceMs = null, stoppedBy = null, errorMessage = null;
  let fellBack = false, grounding = false, drawing = false;
  const upstream = callQwenQuickReplyStream(input, currentState, knowledge, upstreamSignal, meta);

  // Decides what to release for one finished sentence: { text } to say it, { stop } to end the
  // reply, or both. The fallback and guard replacements are only used while nothing was said.
  const check = (raw) => {
    const sentence = raw.replace(/\s+/g, " ").replace(/([。！？!?])[。！？!?]+/g, "$1").trim();
    if (!sentence) return { skip: true };
    const soFar = [...spoken, sentence];
    const whole = soFar.join("");
    const replace = (text, reason) => (spoken.length ? { stop: reason } : { text, stop: reason });
    if (!checkTutorSafetyOutput(whole).ok) return spoken.length ? { stop: "safety" } : { text: fallback, stop: "safety", fellBack: true };
    const grounded = guardScienceReply(whole, input, currentState);
    if (grounded.replaced) return { ...replace(grounded.reply, "grounding"), grounding: true };
    const drawingGuard = guardDrawingReply(whole, input, currentState);
    if (drawingGuard.replaced) return { ...replace(drawingGuard.reply, "drawing"), drawing: true };
    const spaced = soFar.join(" ");
    const adapted = adaptTutorReply(spaced, ageBand);
    if (adapted !== spaced) return replace(adapted, "age-limit");
    return { text: sentence };
  };

  try {
    let ended = false;
    while (!stoppedBy && !ended) {
      const step = await upstream.next();
      if (step.done) ended = true; else buffer += step.value;
      for (let match; (match = SENTENCE_END.exec(buffer));) {
        pending.push(match[1]);
        buffer = buffer.slice(match[0].length);
      }
      if (ended && buffer.trim()) { pending.push(buffer); buffer = ""; }
      for (const raw of pending.splice(0)) {
        const verdict = check(raw);
        if (verdict.skip) continue;
        if (verdict.fellBack) fellBack = true;
        if (verdict.grounding) grounding = true;
        if (verdict.drawing) drawing = true;
        if (verdict.text) {
          spoken.push(verdict.text);
          if (firstSentenceMs === null) { firstSentenceMs = Date.now() - startedAt; clearTimeout(firstTimer); }
          yield { type: "sentence", text: verdict.text };
        }
        if (verdict.stop) { stoppedBy = verdict.stop; break; }
      }
    }
    if (!spoken.length) throw new Error("Qwen quick reply was empty");
  } catch (error) {
    signal?.throwIfAborted();
    errorMessage = timedOut ? `Qwen quick reply timed out after ${firstSentenceMs === null ? firstTimeoutMs : totalTimeoutMs}ms` : error.message;
    if (!spoken.length) {
      fellBack = true;
      spoken.push(fallback);
      yield { type: "sentence", text: fallback };
    } else {
      stoppedBy = stoppedBy || "error";
    }
  } finally {
    clearTimeout(firstTimer);
    clearTimeout(totalTimer);
    controller.abort();
    try { await upstream.return(); } catch { /* upstream already finished or aborted */ }
  }
  yield { type: "done", llmStatus: {
    provider: "qwen",
    ...(fellBack ? {} : { model: process.env.QWEN_MODEL || "qwen3.7-flash" }),
    used: !fellBack,
    fallback: fellBack,
    streamed: true,
    latencyMs: Date.now() - startedAt,
    firstSentenceMs,
    ...(errorMessage ? { message: errorMessage } : {}),
    ...(stoppedBy ? { stoppedBy } : {}),
    ...(fellBack ? {} : {
      tokenUsage: meta.usage,
      knowledgeCardIds: knowledge.cardIds,
      knowledgeIntent: knowledge.intent,
      groundingFallback: grounding,
      drawingClaimFallback: drawing
    })
  } };
}

function shouldUseQwen(currentState, input) {
  if (process.env.TUTOR_ENABLE_LLM === "false") return false;
  if (process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== "qwen") return false;
  if (!process.env.QWEN_API_KEY || process.env.QWEN_API_KEY.startsWith("replace_me")) return false;

  // Keep deterministic assessment/memory flows local for the MVP.
  if (isLessonAnswer(input, currentState.activeLesson)) return false;
  return true;
}

async function callQwenTutor(input, currentState, localState, knowledge, signal, deliveredReply = "") {
  const baseUrl = trimTrailingSlash(process.env.QWEN_BASE_URL || DEFAULT_BASE_URL);
  const model = process.env.QWEN_MODEL || "qwen3.7-flash";
  const maxTokens = Number(process.env.TUTOR_MAX_OUTPUT_TOKENS || 900);
  const temperature = Number(process.env.TUTOR_TEMPERATURE || 0.7);
  const timeoutMs = Number(process.env.TUTOR_LLM_TIMEOUT_MS || 8000);
  const enableThinking = process.env.TUTOR_ENABLE_THINKING === "true";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.QWEN_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: createSystemPrompt(currentState.profile?.ageBand, knowledge.context) + "\n" + scienceInstruction(input, currentState) + (deliveredReply ? "\n这是后台记录提取，不是第二次对话。spokenReply已经向用户说过，不得改写或新增问题、活动、故事选择。tutorReply原样使用spokenReply，board返回blank。只从用户真实原话提取证据，不能把小宇的话当成孩子的表现。" : "") },
          { role: "user", content: JSON.stringify({ ...JSON.parse(createUserPrompt(input, currentState, localState)), spokenReply: deliveredReply || undefined }) }
        ],
        temperature,
        enable_thinking: enableThinking,
        stream: false,
        max_completion_tokens: maxTokens,
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Qwen API failed with ${response.status}`);
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Qwen returned an empty message");
    const parsed = parseJsonObject(content);
    parsed._tokenUsage = normalizeTokenUsage(data.usage);
    return parsed;
  } catch (error) {
    if (error.name === "AbortError" && controller.signal.aborted) {
      throw new Error(`Qwen response timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

}

function buildQuickReplyBody(input, currentState, knowledge, { stream = false } = {}) {
  const model = process.env.QWEN_MODEL || "qwen3.7-flash";
  const speaker = currentState.activeSpeaker || { name: currentState.profile?.name || "孩子", role: "child" };
  const recentMessages = safeConversationMessages(currentState.messages)
    .slice(-12)
    .map((message) => `${message.speakerName || message.role}: ${message.text}`)
    .join("\n");
  return JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content: [
          "你是儿童成长陪伴角色小宇。现在只生成马上读给用户听的中文口语回答。",
          drawingCapability,
          drawingExecutionRule,
          conversationPrinciple,
          explorationInstruction,
          scienceInstruction(input, currentState),
          safetyInstruction,
          `年龄段：${currentState.profile?.ageBand || "4-5"}岁。${getAgeInstruction(currentState.profile?.ageBand || "4-5")}`,
          speaker.role === "child"
            ? "直接回应孩子刚才说的内容，温暖、具体、容易听懂。最多3个短句，尽量不超过90个汉字。"
            : "这是家人说的话。简短确认这是家人观察，并邀请补充具体情境，不把它说成孩子原话。",
          "不要输出JSON、Markdown、标题或设计说明。不要索要姓名、地址、学校、电话、照片等信息。",
          "孩子明确要求故事时才讲一个很短的开头；普通为什么问题先直接解释。",
          createKnowledgeContext(knowledge)
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({ speakerInput: input, speakerRole: speaker.role || "child", recentMessages,
          inputModality: "text", imageAvailable: false })
      }
    ],
    enable_thinking: false,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    temperature: 0.65,
    max_completion_tokens: Number(process.env.TUTOR_QUICK_MAX_OUTPUT_TOKENS || 180)
  });
}

async function callQwenQuickReply(input, currentState, knowledge, signal) {
  const baseUrl = trimTrailingSlash(process.env.QWEN_BASE_URL || DEFAULT_BASE_URL);
  const timeoutMs = Number(process.env.TUTOR_QUICK_TIMEOUT_MS || 3500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.QWEN_API_KEY}`
      },
      body: buildQuickReplyBody(input, currentState, knowledge)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `Qwen quick reply failed with ${response.status}`);
    const content = shortText(data.choices?.[0]?.message?.content, 220);
    if (!content) throw new Error("Qwen quick reply was empty");
    return { reply: content, tokenUsage: normalizeTokenUsage(data.usage) };
  } catch (error) {
    if (error.name === "AbortError" && controller.signal.aborted) throw new Error(`Qwen quick reply timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Yields raw text deltas from the model as they arrive. Token usage, when the provider
// reports it, is written to meta.usage.
async function* callQwenQuickReplyStream(input, currentState, knowledge, signal, meta) {
  const baseUrl = trimTrailingSlash(process.env.QWEN_BASE_URL || DEFAULT_BASE_URL);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.QWEN_API_KEY}`
    },
    body: buildQuickReplyBody(input, currentState, knowledge, { stream: true })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error?.message || `Qwen quick reply failed with ${response.status}`);
  }
  if (!response.body) throw new Error("Qwen quick reply returned no stream");
  const decoder = new TextDecoder();
  const texts = [];
  let failure = null;
  const parser = createParser({
    onError: (error) => { failure = error; },
    onEvent: ({ data }) => {
      if (data === "[DONE]") return;
      try {
        const event = JSON.parse(data);
        if (event.error) throw new Error(event.error.message || "Qwen quick reply stream failed");
        const text = event.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) texts.push(text);
        if (event.usage) meta.usage = normalizeTokenUsage(event.usage);
      } catch (error) { failure = error; }
    }
  });
  try {
    for await (const chunk of response.body) {
      parser.feed(decoder.decode(chunk, { stream: true }));
      if (failure) throw failure;
      while (texts.length) yield texts.shift();
    }
    parser.feed(decoder.decode());
    if (failure) throw failure;
    while (texts.length) yield texts.shift();
  } finally {
    try { await response.body.cancel(); } catch { /* already closed */ }
  }
}

function createSystemPrompt(ageBand = "4-5", knowledgeContext = "") {
  return [
    "你是小宇，来自家庭成长陪伴产品“小宇记”。孩子和家人都可以与你进行中文语音对话。",
    safetyInstruction,
    drawingCapability,
    drawingExecutionRule,
    conversationPrinciple,
    explorationInstruction,
    "对话没有固定倒计时，由家庭自然开始和结束；不用考试、排名、提分话术；合适时鼓励孩子离开屏幕去画、找、说、动手。",
    "你的输出必须是严格 JSON，不要 markdown，不要解释 JSON 外的内容。",
    "回复孩子时要短、温暖、口语化。回复成人时同样简洁，并先确认对方提供的是家人观察，不是孩子原话。",
    `当前年龄段是 ${ageBand} 岁。年龄表达规则：${getAgeInstruction(ageBand)}`,
    knowledgeContext,
    "必须直接回应 speakerInput 里的真实问题。不要因为最近对话或示例，把问题改成另一个主题。",
    "如果孩子问“为什么/怎么回事”，优先解释这个现象；如果孩子明确说想听故事，才讲故事。",
    "不要索要儿童真实姓名、住址、学校、电话、照片等敏感信息。",
    "安全求助优先于普通陪伴，不转去无关游戏；非紧急常识可以适龄解释。",
    "白板只允许使用这些 type：blank, story, science, language, math, english, welcome, safety。",
    "普通聊天、家人观察、不需要图的回答或无法提供准确配图时，返回 board: {type: 'blank'}。绝不为了填满白板添加无关物品。",
    "offlineTask 可以为 null；不为补齐字段生成活动。没有值得保存的真实证据时 growthEvidence.shouldSave 为 false。故事分支只是可选结构，不把示例当成当前任务。",
    "本版科学白板只支持明确的找颜色活动，其他科学解释先用语音并返回 blank。数学旧白板仅支持苹果计数，其他物品不要替换成苹果。积木交互由本地场景系统处理。",
    "JSON schema：",
    "{",
    '  "tutorReply": "给孩子听的一小段话",',
    '  "board": {',
    '    "type": "blank|story|science|language|math|english|welcome|safety",',
    '    "title": "白板标题",',
    '    "mode": "互动|故事|探索|表达|安全",',
    '    "items": ["3 到 5 个短标签"],',
    '    "question": "问孩子的一个短问题",',
    '    "note": "给成人看的设计说明",',
    '    "story": {',
    '      "id": "optional_story_id",',
    '      "title": "故事名",',
    '      "character": "角色",',
    '      "setting": "地点",',
    '      "object": "关键物品",',
    '      "scenes": ["最多 3 个短句"],',
    '      "choices": [],',
    '      "parentPrompt": "成人可以怎么接",',
    '      "domainLabels": ["语言", "情绪"],',
    '      "dialogicPrompts": [{ "type": "predict", "text": "你觉得会发生什么？" }],',
    '      "observationFocus": ["是否愿意选择", "是否能说原因"],',
    '      "offlineActivityId": "story_retell_draw"',
    "    }",
    "  },",
    '  "offlineTask": {',
    '    "title": "离屏任务名",',
    '    "domain": "表达|自然探索|数感|社会情绪",',
    '    "screenTime": "离开屏幕 5-8 分钟",',
    '    "purpose": "为什么做",',
    '    "materials": ["纸", "彩笔"],',
    '    "steps": ["步骤 1", "步骤 2", "步骤 3"],',
    '    "adultPrompt": "成人可以这样问",',
    '    "observeFocus": ["观察点 1", "观察点 2"],',
    '    "reason": "为什么给这个任务"',
    "  },",
    '  "memorySignals": {',
    '    "interests": ["孩子表现出的兴趣"],',
    '    "recentWin": "一句具体积极观察",',
    '    "attentionNote": "可选，孩子可能需要的支持"',
    "  },",
    '  "growthEvidence": {',
    '    "type": "question|interest|expression|choice|attempt|story|observation",',
    '    "sourceQuote": "孩子说话时必须逐字来自 speakerInput；成人说话时仅作为家庭观察",',
    '    "topics": ["最多 4 个本轮明确出现的主题"],',
    '    "domains": ["story|science|math|language|english|explore|art|social"],',
    '    "observation": "只描述本轮可观察到的行为，不做性格或能力诊断",',
    '    "childIntent": "提问|分享经历|讲故事|表达选择|尝试回答等",',
    '    "inference": "可选且克制的推测，没有依据时留空",',
    '    "confidence": 0.0,',
    '    "shouldSave": true',
    "  }",
    "}"
  ].join("\n");
}

function createUserPrompt(input, currentState, localState) {
  const profile = currentState.profile || {};
  const memory = currentState.memory || {};
  const speaker = currentState.activeSpeaker || { name: profile.name || "孩子", role: "child" };
  const recentMessages = safeConversationMessages(currentState.messages)
    .slice(-12)
    .map((message) => `${message.speakerName || message.role}: ${message.text}`)
    .join("\n");

  return JSON.stringify(
    {
      speakerInput: input,
      inputModality: "text",
      imageAvailable: false,
      activeSpeaker: {
        name: speaker.name || "家人",
        role: speaker.role || "other",
        isChild: (speaker.role || "child") === "child"
      },
      childProfile: {
        nickname: profile.name || "小朋友",
        ageBand: profile.ageBand || "4-5",
        interests: profile.interest || memory.interests?.join("、") || "还没有可靠记录",
        parentGoal: profile.goal || "跟随孩子自然表达"
      },
      recentMessages,
      instruction:
        speaker.role === "child"
          ? "请直接回应 speakerInput。近期对话只用于理解追问，历史兴趣不能改变当前主题；不需要图时返回blank，不要添加随机任务。输出严格 JSON。"
          : "这是家人提供的反馈或问题。请简短回应，并邀请补充具体时间、情境或孩子原话。不要更新孩子兴趣、能力或成长结论；growthEvidence.shouldSave 必须为 false。输出严格 JSON。"
    },
    null,
    2
  );
}

function mergeLlmTurn(localState, llmTurn, knowledge = { cardIds: [], intent: "general" }) {
  const isChildSpeaker = !localState.activeSpeaker?.role || localState.activeSpeaker.role === "child";
  const board = isChildSpeaker ? relevantBoard(normalizeBoard(llmTurn.board, localState.board), latestChildText(localState), localState.board) : { type: "blank" };
  const normalizedEvidence = normalizeGrowthEvidence(llmTurn.growthEvidence, latestChildText(localState), board);
  const growthEvidence = isChildSpeaker ? normalizedEvidence : { ...normalizedEvidence, shouldSave: false, inference: "" };
  const offlineTask = isChildSpeaker ? normalizeOfflineTask(llmTurn.offlineTask, localState.offlineTask) : localState.offlineTask;
  const messages = replaceLatestTutor(localState.messages, llmTurn.tutorReply, localState.profile?.ageBand);
  const memory = isChildSpeaker ? mergeMemorySignals(localState.memory, llmTurn.memorySignals, growthEvidence) : localState.memory;
  const activeLesson = mergeActiveLesson(localState.activeLesson, board);

  return {
    ...localState,
    messages,
    board,
    offlineTask,
    memory,
    activeLesson,
    growthEvidence,
    llmStatus: {
      provider: "qwen",
      model: process.env.QWEN_MODEL || "qwen3.7-flash",
      used: true,
      fallback: false,
      knowledgeCardIds: knowledge.cardIds,
      knowledgeIntent: knowledge.intent,
      tokenUsage: llmTurn._tokenUsage || null
    }
  };
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens);
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) return null;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

export function validateTutorOutput(llmTurn, { input = "", currentState = {}, knowledge = {} } = {}) {
  if (!llmTurn || typeof llmTurn !== "object") return { ok: false, reason: "response is not an object" };
  const safetyCheck = checkTutorSafetyOutput(llmTurn);
  if (!safetyCheck.ok) return safetyCheck;
  if (!String(llmTurn.tutorReply || "").trim()) return { ok: false, reason: "tutorReply is empty" };
  if (String(llmTurn.tutorReply).length > 360) return { ok: false, reason: "tutorReply is too long" };
  if (Array.isArray(llmTurn.board?.items) && llmTurn.board.items.length > 5) return { ok: false, reason: "board has too many items" };
  if (Array.isArray(llmTurn.offlineTask?.steps) && llmTurn.offlineTask.steps.length > 4) return { ok: false, reason: "offline task has too many steps" };

  const allowedBoardTypes = new Set(["blank", "story", "science", "language", "math", "english", "welcome", "safety"]);
  if (llmTurn.board?.type && !allowedBoardTypes.has(llmTurn.board.type)) {
    return { ok: false, reason: "board type is outside the product contract" };
  }

  const isChildSpeaker = !currentState.activeSpeaker?.role || currentState.activeSpeaker.role === "child";
  if (!isChildSpeaker && llmTurn.growthEvidence?.shouldSave === true) {
    return { ok: false, reason: "adult input cannot create child growth evidence" };
  }

  const forbiddenClaims = /(诊断|确诊|智商|排名|百分位|一定是|肯定是|发育迟缓)/;
  const userVisibleFields = [
    llmTurn.tutorReply,
    llmTurn.board?.title,
    llmTurn.board?.question,
    llmTurn.board?.note,
    llmTurn.offlineTask?.title,
    llmTurn.offlineTask?.purpose,
    llmTurn.offlineTask?.adultPrompt,
    llmTurn.offlineTask?.reason,
    llmTurn.growthEvidence?.observation,
    llmTurn.growthEvidence?.inference,
    llmTurn.memorySignals?.recentWin,
    llmTurn.memorySignals?.attentionNote
  ];
  if (userVisibleFields.some((field) => forbiddenClaims.test(String(field || "")))) {
    return { ok: false, reason: "output contains a forbidden claim" };
  }
  if (llmTurn.growthEvidence?.sourceQuote && !String(input).includes(String(llmTurn.growthEvidence.sourceQuote))) {
    return { ok: false, reason: "growth evidence quote is not grounded in input" };
  }
  if (knowledge.cardIds && llmTurn.knowledgeCardIds) {
    const allowed = new Set(knowledge.cardIds);
    if (llmTurn.knowledgeCardIds.some((id) => !allowed.has(id))) return { ok: false, reason: "unknown knowledge card selected" };
  }
  return { ok: true };
}

function normalizeBoard(board, fallback) {
  if (!board || typeof board !== "object" || board.type === "blank") return { type: "blank" };
  fallback = fallback?.type === board.type ? fallback : { type: "blank" };

  const type = ["story", "science", "language", "math", "english", "welcome", "safety"].includes(board.type)
    ? board.type
    : fallback.type;

  const normalized = {
    ...board,
    type,
    title: shortText(board.title || fallback.title, 32),
    mode: shortText(board.mode || fallback.mode || "互动", 16),
    items: board.type === "english" ? board.items : normalizeStringArray(board.items, [], 5),
    question: shortText(board.question || fallback.question || "你想怎么做？", 42),
    note: shortText(board.note || fallback.note || "AI 生成的短互动。", 90)
  };

  if (type === "story") {
    normalized.story = normalizeStory(board.story, fallback.story);
  }

  return normalized;
}

function normalizeStory(story, fallback = {}) {
  const choices = normalizeStringArray(story?.choices, fallback?.choices || ["红色的门", "蓝色的门", "绿色的门"], 3);
  return {
    ...fallback,
    id: shortText(story?.id || fallback?.id || "qwen_story", 40),
    title: shortText(story?.title || fallback?.title || "小宇的小故事", 24),
    character: shortText(story?.character || fallback?.character || "小兔子", 16),
    setting: shortText(story?.setting || fallback?.setting || "小花园", 16),
    object: shortText(story?.object || fallback?.object || "一片亮亮的叶子", 18),
    scenes: normalizeStringArray(story?.scenes, fallback?.scenes || ["小伙伴发现了一个新东西。"], 3, 34),
    choices,
    parentPrompt: shortText(story?.parentPrompt || fallback?.parentPrompt || "可以请孩子画出故事里的一个东西。", 70),
    domainLabels: normalizeStringArray(story?.domainLabels, fallback?.domainLabels || ["语言", "表达"], 4, 8),
    dialogicPrompts: normalizePrompts(story?.dialogicPrompts, fallback?.dialogicPrompts),
    observationFocus: normalizeStringArray(story?.observationFocus, fallback?.observationFocus || ["是否愿意选择", "是否能说原因"], 4, 18),
    offlineActivityId: story?.offlineActivityId || fallback?.offlineActivityId || "story_retell_draw"
  };
}

function normalizePrompts(prompts, fallback = []) {
  const source = Array.isArray(prompts) && prompts.length ? prompts : fallback;
  const safe = source.slice(0, 2).map((prompt) => ({
    type: ["predict", "recall", "relate", "feeling", "create"].includes(prompt?.type) ? prompt.type : "predict",
    text: shortText(prompt?.text || "你觉得接下来会发生什么？", 30)
  }));
  return safe.length ? safe : [{ type: "predict", text: "你觉得接下来会发生什么？" }];
}

function normalizeOfflineTask(task, fallback) {
  if (!task || typeof task !== "object") return fallback;

  return {
    ...fallback,
    id: fallback?.id || `qwen_${Date.now()}`,
    title: shortText(task.title || fallback?.title || "画一画刚才的想法", 24),
    domain: shortText(task.domain || fallback?.domain || "表达", 12),
    screenTime: shortText(task.screenTime || fallback?.screenTime || "离开屏幕 5-8 分钟", 22),
    purpose: shortText(task.purpose || fallback?.purpose || "把 AI 互动转成现实世界里的表达。", 70),
    materials: normalizeStringArray(task.materials, fallback?.materials || ["纸", "彩笔"], 4, 14),
    steps: normalizeStringArray(task.steps, fallback?.steps || ["画出刚才想到的东西。", "讲给成人听。"], 4, 34),
    adultPrompt: shortText(task.adultPrompt || fallback?.adultPrompt || "你可以问：你刚才最喜欢哪一部分？", 45),
    observeFocus: normalizeStringArray(task.observeFocus, fallback?.observeFocus || ["是否愿意表达", "是否需要提示"], 4, 20),
    reason: shortText(task.reason || fallback?.reason || "根据本轮互动生成。", 60),
    status: "assigned",
    assignedAt: new Date().toISOString()
  };
}

function replaceLatestTutor(messages, reply, ageBand) {
  const text = adaptTutorReply(shortText(reply || "", 260), ageBand);
  if (!text) return messages;

  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].role === "tutor") {
      next[index] = { role: "tutor", text };
      return next;
    }
  }
  return [...next, { role: "tutor", text }];
}

function mergeMemorySignals(memory, signals = {}, growthEvidence = {}) {
  const evidenceTopics = growthEvidence.shouldSave && growthEvidence.confidence >= 0.6 ? growthEvidence.topics : [];
  const interests = [
    ...new Set([
      ...(memory.interests || []),
      ...evidenceTopics
    ])
  ].slice(-6);

  const observedSignal = growthEvidence.shouldSave && growthEvidence.confidence >= 0.6 ? growthEvidence.observation : "";
  const recentWins = observedSignal
    ? [shortText(observedSignal, 42), ...(memory.recentWins || [])].slice(0, 4)
    : memory.recentWins;

  return {
    ...memory,
    interests,
    recentWins
  };
}

export function normalizeGrowthEvidence(evidence, childInput, board = {}) {
  if (isInteractionControl(childInput)) return {
    type: "expression", sourceQuote: shortText(childInput, 360), topics: [], domains: [],
    observation: "", childIntent: "", inference: "", confidence: 0, shouldSave: false
  };
  const source = evidence && typeof evidence === "object" ? evidence : {};
  const input = shortText(childInput, 360);
  const requestedQuote = shortText(source.sourceQuote, 360);
  const sourceQuote = requestedQuote && input.includes(requestedQuote) ? requestedQuote : input;
  const allowedTypes = ["question", "interest", "expression", "choice", "attempt", "story", "observation"];
  const allowedDomains = ["story", "science", "math", "language", "english", "explore", "art", "social"];
  const fallbackDomain = allowedDomains.includes(board.type) ? board.type : "language";
  const domains = normalizeStringArray(source.domains, [fallbackDomain], 4, 12).filter((item) => allowedDomains.includes(item));
  const confidence = Number(source.confidence);

  return {
    type: allowedTypes.includes(source.type) ? source.type : inferEvidenceType(input, board.type),
    sourceQuote,
    topics: normalizeStringArray(source.topics, [], 4, 16),
    domains: domains.length ? domains : [fallbackDomain],
    observation: shortText(source.observation || "记录孩子本轮主动说出的内容。", 120),
    childIntent: shortText(source.childIntent, 40),
    inference: shortText(source.inference, 100),
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.7,
    shouldSave: source.shouldSave !== false
  };
}

function inferEvidenceType(input, boardType) {
  if (/[？?]/.test(input) || /^(为什么|怎么|哪里|什么|谁)/.test(input)) return "question";
  if (boardType === "story") return "story";
  return "expression";
}

function mergeActiveLesson(activeLesson, board) {
  if (board.type !== "story" || !board.story) return activeLesson;
  return {
    ...(activeLesson || {}),
    activity: "story",
    skill: "language.full_sentence",
    plannerReason: board.note,
    story: board.story
  };
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Qwen response was not JSON");
    return JSON.parse(match[0]);
  }
}

function normalizeStringArray(value, fallback = [], limit = 4, maxLength = 18) {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .map((item) => shortText(item, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

function shortText(value, maxLength) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function latestTutorText(state) {
  return [...(state.messages || [])].reverse().find((message) => message.role === "tutor")?.text || "";
}

function latestChildText(state) {
  return [...(state.messages || [])].reverse().find((message) => message.role === "child")?.text || "";
}
