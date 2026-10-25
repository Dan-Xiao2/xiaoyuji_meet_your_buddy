// Reviewed factual seed, separate from parenting advice and activity suggestions.
// Sources/review scope: docs/science-factual-seeds.md.
import { isTopicChange } from "../src/services/conversationIntent.js";

export function solarContext(input, state = {}) {
  const text = String(input);
  if (/(?:不是|不聊|别聊|不要聊)太阳/.test(text)) return false;
  if (/太阳/.test(text)) return true;
  const followup = value => /^(?:那)?(?:它|为什么|会不会|有多|多久)/.test(value) &&
    !/月亮|房子|积木|恐龙|树/.test(value);
  if (isTopicChange(text) || !followup(text)) return false;
  const children = (state.messages || []).filter(message => message.role === "child" &&
    (!message.speakerRole || message.speakerRole === "child"));
  if (children.at(-1)?.text === text) children.pop();
  // Stop at a new subject instead of searching past it for an older solar mention.
  for (const message of children.reverse()) {
    const previous = String(message.text || "");
    if (/(?:不是|不聊|别聊|不要聊)太阳/.test(previous)) return false;
    if (/太阳/.test(previous)) return true;
    if (isTopicChange(previous) || !followup(previous)) return false;
  }
  return false;
}

export function scienceInstruction(input, state) {
  const base = "科学问题可以简化词汇，但不能编造机制，不把童话当成事实。不要强行做比喻或每轮安排动手任务；不确定时承认不确定。";
  return base + (solarContext(input, state)
    ? " 本轮太阳事实：太阳是一颗恒星，核心发生核聚变，氢转变为氦并释放能量，产生光和热。不是小星星互相摩擦，不是普通火焰燃烧。太阳不会永远保持现在的状态，演化发生在数十亿年尺度，不会明天突然熄灭。可用幼儿表达：太阳里面的小粒子合在一起，放出很多能量。不可邀请直视太阳、望远镜看太阳或触摸热源；若提观察，只建议和大人看地上的影子，不看太阳本身。"
    : "");
}

export function guardScienceReply(reply, input, state) {
  if (!solarContext(input, state)) return { reply, replaced: false };
  if (/太阳(?:是|会|在)?(?:绕着|围着|绕)地球/.test(reply)) return {
    reply: "地球绕着太阳转，也在自己转动。我们看到太阳每天在天空中移动，主要是因为地球在自转。", replaced: true
  };
  const wrong = /小星星|摩擦|搓手|摸摸|摸太阳|(?:去|抬头|直接|仔细|望远镜).*看.*太阳|永远.*(?:亮|发光)|一直.*不会熄灭/.test(reply);
  if (!wrong) return { reply, replaced: false };
  const replacement = /熄灭|永远|多久/.test(input)
    ? "太阳不会明天突然熄灭。它还会发光很久很久，以后才慢慢发生变化。"
    : "太阳里面的小粒子合在一起，放出很多能量，所以太阳会发光、发热。不能直接盯着太阳看哦。";
  return { reply: replacement, replaced: true };
}
