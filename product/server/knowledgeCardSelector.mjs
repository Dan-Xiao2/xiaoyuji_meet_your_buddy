import { readFileSync } from "node:fs";

const knowledgeBase = JSON.parse(
  readFileSync(new URL("../skills/xiaoyu-growth-companion/references/knowledge-cards.json", import.meta.url), "utf8")
);

const cards = knowledgeBase.cards || [];
const MAX_CARDS = 3;

const intentRules = [
  { intent: "safety", pattern: /(危险|受伤|疼|吃药|发烧|身体|陌生人|隐私|不舒服|害怕有人)/ },
  { intent: "kindergarten_transition", pattern: /(幼儿园|入园|放学|老师|同学|想妈妈|想爸爸|不想去)/ },
  { intent: "emotion_repair", pattern: /(生气|哭|难过|害怕|不开心|吵架|没听见|对不起|安慰)/ },
  { intent: "peer_problem", pattern: /(朋友|同伴|抢|分享|轮流|一起玩|不让玩)/ },
  { intent: "drawing", pattern: /(画画|画一画|绘画|涂色|作品|画的什么)/ },
  { intent: "reading", pattern: /(故事|童话|绘本|读书|书里|讲.*听)/ },
  { intent: "exploration", pattern: /(为什么|怎么回事|观察|探索|自然|颜色|叶子|植物|动物|恐龙|月亮|太阳|找一找|比较)/ },
  { intent: "language", pattern: /(说话|表达|句子|怎么说|词|名字|讲清楚|不会说)/ }
];

const intentCardIds = {
  safety: ["safe-sensory-exploration", "two-safe-choices"],
  kindergarten_transition: ["kindergarten-transition-ritual", "tell-me-one-moment", "repair-after-disconnection"],
  emotion_repair: ["repair-after-disconnection", "name-and-accept-emotion", "child-led-play"],
  peer_problem: ["cooperative-problem-solving", "friend-perspective", "pretend-play"],
  drawing: ["draw-and-talk", "open-art-expression", "story-to-real-world"],
  reading: ["shared-reading-follow-child", "picture-book-dialogue", "story-to-real-world"],
  exploration: ["hands-on-choice-exploration", "why-to-observation", "compare-count-real-things"],
  language: ["responsive-back-and-forth", "expand-and-wait", "picture-book-dialogue"],
  general: ["child-led-play", "responsive-back-and-forth", "tell-me-one-moment"]
};

export function selectKnowledgeCards({ input = "", currentState = {}, limit = MAX_CARDS } = {}) {
  const text = String(input || "").trim();
  const profile = currentState.profile || {};
  const speaker = currentState.activeSpeaker || { role: "child" };
  const ageBand = normalizeAgeBand(profile.ageBand || "4-5");
  const speakerRole = speaker.role || "child";
  const intent = inferIntent(text);
  const preferredIds = intentCardIds[intent] || intentCardIds.general;
  const preferredRank = new Map(preferredIds.map((id, index) => [id, preferredIds.length - index]));

  const ranked = cards
    .filter((card) => card.ageBands?.includes(ageBand))
    .filter((card) => isDeliveryAllowed(card.deliveryMode, speakerRole))
    .map((card) => ({
      card,
      score: scoreCard(card, text, intent, preferredRank)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id));

  const selected = ranked.slice(0, Math.max(1, Math.min(MAX_CARDS, limit))).map(({ card }) => toPromptCard(card));
  return {
    intent,
    ageBand,
    speakerRole,
    cardIds: selected.map((card) => card.id),
    cards: selected,
    context: createKnowledgeContext({ intent, ageBand, speakerRole, cards: selected })
  };
}

export function createKnowledgeContext({ intent, ageBand, speakerRole, cards: selectedCards = [] } = {}) {
  if (!selectedCards.length) return "本轮没有匹配到专门知识卡，请遵守核心安全与年龄规则，简短回应并保持不确定性。";
  return JSON.stringify(
    {
      instruction: "这些是本轮可参考的少量知识卡，不是必须逐字照搬的脚本。孩子当前问题、更正和话题优先；只采用相关部分，观察信号不是需要套问的任务，offlineAction可不采用。不为知识卡强行追问、做活动或记录成长。不要提及卡片、书籍或内部规则。",
      intent,
      ageBand,
      speakerRole,
      cards: selectedCards
    },
    null,
    2
  );
}

export function inferIntent(input = "") {
  return intentRules.find((rule) => rule.pattern.test(input))?.intent || "general";
}

function scoreCard(card, input, intent, preferredRank) {
  const preferred = preferredRank.get(card.id) || 0;
  const searchText = [
    card.title,
    card.purpose,
    ...(card.observeSignals || []),
    ...(card.companionMoves || []),
    ...(card.triggers || [])
  ]
    .join(" ")
    .toLowerCase();
  const inputWords = input
    .toLowerCase()
    .split(/[，。！？、\s]+/)
    .filter((word) => word.length >= 2);
  const keywordHits = inputWords.filter((word) => searchText.includes(word)).length;
  const intentBonus = preferred > 0 ? preferred * 10 : 0;
  const generalBonus = intent === "general" ? 1 : 0;
  return intentBonus + keywordHits * 3 + generalBonus;
}

function isDeliveryAllowed(deliveryMode, speakerRole) {
  if (speakerRole === "child") return ["child_voice", "shared_device_with_parent", "parent_assisted"].includes(deliveryMode);
  return ["parent_assisted", "shared_device_with_parent"].includes(deliveryMode);
}

function normalizeAgeBand(ageBand) {
  if (ageBand === "0-1" || ageBand === "1-2" || ageBand === "2-3" || ageBand === "3-4" || ageBand === "4-5" || ageBand === "5-6") {
    return ageBand;
  }
  if (ageBand === "6-7") return "5-6";
  return "4-5";
}

function toPromptCard(card) {
  return {
    id: card.id,
    title: card.title,
    purpose: card.purpose,
    observeSignals: (card.observeSignals || []).slice(0, 3),
    companionMoves: (card.companionMoves || []).slice(0, 3),
    offlineAction: {
      title: card.offlineAction?.title,
      steps: (card.offlineAction?.steps || []).slice(0, 3),
      durationMinutes: card.offlineAction?.durationMinutes
    },
    avoid: (card.avoid || []).slice(0, 3),
    sourceIds: card.sourceIds || []
  };
}
