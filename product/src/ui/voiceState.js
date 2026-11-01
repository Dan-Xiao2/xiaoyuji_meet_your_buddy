const VOICE_PHASES = new Set(["ready", "listening", "thinking", "speaking", "retry"]);

// Media owns capture/playback; background enrichment/images never block listening.
export function deriveVoiceUiState({ active = true, visible = true, media = {}, conversation = {}, drawingPlan = {} }, options = {}) {
  let phase = "ready";
  if (visible) {
    if (media.input === "capturing") phase = "listening";
    else if (media.output === "playing") phase = "speaking";
    else if (media.failure) phase = "retry";
    else if (media.input === "processing" || media.output === "preparing") phase = "thinking";
    else if (active && (conversation.awaitingReply || drawingPlan.phase === "pending")) phase = "thinking";
    else if (active && conversation.phase === "failed" && !conversation.replyAccepted) phase = "retry";
  }
  return createVoiceUiState(phase, { ...options, detail: media.readyDetail || options.detail });
}

export function getVoiceStageLayout(board = {}) {
  return board?.type && board.type !== "blank" ? "whiteboard" : "voice";
}

export function shouldFinishVoiceOnRelease({ wasAlreadyListening = false, pressDurationMs = 0, holdThresholdMs = 550 } = {}) {
  return wasAlreadyListening || pressDurationMs >= holdThresholdMs;
}

export function createVoiceUiState(phase = "ready", options = {}) {
  const safePhase = VOICE_PHASES.has(phase) ? phase : "ready";
  const name = String(options.name || "").trim();
  const readyDetail = name ? `嗨${name}，今天想告诉我什么？` : "小宇在这里，想说什么都可以";
  const content = {
    ready: {
      title: "和小宇说说话",
      detail: options.detail || readyDetail,
      ariaLabel: "点一下开始和小宇说话",
      status: "可以说"
    },
    listening: {
      title: "我在听",
      detail: "说完就好",
      ariaLabel: "小宇正在听，点一下可以暂停",
      status: "正在听"
    },
    thinking: {
      title: "小宇想一想",
      detail: "马上就回答你",
      ariaLabel: "小宇正在想",
      status: "正在想"
    },
    speaking: {
      title: "小宇在说",
      detail: "说完会继续听你说",
      ariaLabel: "小宇正在说，点一下可以插话",
      status: "正在说"
    },
    retry: {
      title: "再试一次",
      detail: "点一下，慢慢说一次",
      ariaLabel: "点一下再说一次",
      status: "可以再试一次"
    }
  }[safePhase];

  return { phase: safePhase, ...content };
}
