// A bounded, deterministic pilot: the same plan supplies speech and object changes.
import { resolveIllustrationPlan, validIllustrationScene } from "./illustrationPlan.js";
import { validImageBoard } from "./openDrawing.js";
import { isTopicChange, topicChangeDrawingInput } from "../services/conversationIntent.js";
export function validVisualScene(board) { return validBlockScene(board) || validIllustrationScene(board); }
const numberPattern = "(?:\\d+|[零一二两三四五六七八九十]+)";
const numbers = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const integer = value => /^\d+$/.test(value || "") ? Number(value) : numbers[value];
const amount = (text, pattern) => integer(text.match(new RegExp(pattern.replaceAll("#", numberPattern)))?.[1]);
const recipientPattern = "(爸爸|妈妈|爷爷|奶奶|哥哥|姐姐|朋友)";
const whole = value => Number.isInteger(value) && value >= 0 && value <= 10;

export function validBlockScene(board) {
  const scene = board?.scene;
  return board?.type === "scene" && scene?.kind === "blocks" &&
    whole(scene.total) && scene.total > 0 && whole(scene.given) && scene.given <= scene.total &&
    whole(scene.fromGiven) && scene.fromGiven <= scene.total &&
    typeof scene.id === "string" && scene.id.length <= 100 &&
    Number.isInteger(scene.revision) && scene.revision >= 0 &&
    new RegExp(`^${recipientPattern}$`).test(scene.recipient) &&
    Array.isArray(scene.steps) && scene.steps.length >= 1 && scene.steps.length <= 3 &&
    scene.steps.every(step => whole(step.given) && step.given <= scene.total && typeof step.text === "string" && step.text.length <= 120);
}

export function resolveVisualPlan(input, state = {}) {
  if (isTopicChange(input)) {
    input = topicChangeDrawingInput(input);
    if (!input) return null;
  }
  const drawing = validImageBoard(state.board) ? null : resolveIllustrationPlan(input, state);
  if (drawing) return drawing;
  if (state.activeSpeaker?.role && state.activeSpeaker.role !== "child") return null;
  const text = String(input).trim();
  const previous = validBlockScene(state.board) ? state.board.scene : null;
  const explicit = /积木/.test(text) && !/(故事|童话|不要|不想)/.test(text) &&
    (new RegExp(numberPattern + "\\s*(?:块|个)?积木").test(text) || /分|给|数一数/.test(text));
  const followup = previous && new RegExp(
    "^(?:那)?(?:再)?(?:(?:给|送给|分给)(?:了)?" + recipientPattern + "?\\s*" + numberPattern +
    "|(?:拿回|收回|拿走|送出|分出|换成|改成)\\s*" + numberPattern +
    "|(?:还剩|剩下|剩|是|我觉得是)?\\s*" + numberPattern +
    "|重来|从头|重新|再演示|再画|再看)\\s*(?:块|个)?[。！!？?]?$"
  ).test(text);
  if (!explicit && !followup) return null;
  let total = explicit ? amount(text, "(#)\\s*(?:块|个)?积木") : previous.total;
  const recipient = text.match(new RegExp(recipientPattern))?.[1] || previous?.recipient || "爸爸";
  let given = previous && !explicit ? previous.given : 0;
  // recipientPattern has a capture; read the quantity explicitly.
  const transferMatch = text.match(new RegExp("(?:给|送给|分给)(?:了)?" + recipientPattern + "\\s*(" + numberPattern + ")"));
  const taken = amount(text, "(?:拿走|送出|分出|给)(?:了)?\\s*(#)");
  const returned = amount(text, "(?:拿回|收回)\\s*(#)");
  const changed = amount(text, "(?:换成|改成)\\s*(#)");
  if (Number.isFinite(changed)) total = changed;
  const moving = transferMatch ? integer(transferMatch[2]) : taken;
  if (Number.isFinite(moving)) given = previous && !explicit && /再/.test(text) ? given + moving : moving;
  if (Number.isFinite(returned)) given -= returned;
  const answerMatch = previous && text.match(new RegExp("^(?:还剩|剩下|剩|是|我觉得是)?\\s*(" + numberPattern + ")\\s*(?:块|个)?[。！!？?]?$"));
  const answer = answerMatch ? integer(answerMatch[1]) : undefined;
  const unsupportedNumber = text.match(new RegExp(numberPattern, "g"))?.some(value => !whole(integer(value)));
  if (unsupportedNumber || /[-负]\s*[\d一二两三四五六七八九十]|[\d一二两三四五六七八九十][.点][\d一二两三四五六七八九十]/.test(text) ||
      (previous && !explicit && previous.given > 0 && recipient !== previous.recipient) ||
      !whole(total) || total < 1 || !whole(given) || given > total) return {
    board: { type: "blank" },
    reply: "这次先用一到十块积木来摆。你有几块，想给出去几块？",
    segments: []
  };
  const replay = /重来|从头|重新|再.*(?:演示|画|看)/.test(text);
  const fromGiven = previous && !explicit && !replay ? Math.min(previous.given, total) : 0;
  const steps = answerMatch ? [{
    given, text: answer === total - given
      ? `是的，还剩${total - given}块。也可以拿家里的积木摆一摆。`
      : `我们一起看看留下的积木，还有${total - given}块。你可以点着一块一块数。`
  }] : [
    { given: fromGiven, text: fromGiven === 0 ? `这里有${total}块积木。` : `我们接着看这${total}块积木。` },
    { given, text: given === fromGiven
      ? `你可以点着积木数一数。`
      : given > fromGiven
        ? `把${given - fromGiven}块给${recipient}。你这里还剩几块？`
        : `从${recipient}那里拿回${fromGiven - given}块。现在你这里有几块？` }
  ];
  const scene = {
    kind: "blocks", id: previous?.id || `blocks-${state.session?.id || "local"}`,
    revision: (previous?.revision || 0) + 1, total, given, fromGiven, recipient, steps
  };
  return {
    board: { type: "scene", title: "分一分积木", scene },
    reply: steps.map(step => step.text).join(""),
    segments: steps
  };
}

export function relevantBoard(board, input, previousBoard = null) {
  if (!board || typeof board !== "object") return { type: "blank" };
  if (validImageBoard(board)) return board;
  if (board.type === "blank" || board.type === "safety") return board;
  if (board.type === "scene") return validVisualScene(board) ? board : { type: "blank" };
  const text = String(input || "");
  if (board.type === "science") {
    // Concept labels are not a visual explanation. Only retain the explicit color activity for now.
    if (/找.*颜色|颜色.*找/.test(text) && board.items?.length === 3 &&
      board.items.every(item => ["红色", "黄色", "绿色"].includes(item))) return board;
    return { type: "blank" };
  }
  if (board.type === "story") {
    if (/故事|童话|讲.*听/.test(text) || (previousBoard?.type === "story" && /选择|继续/.test(text))) return board;
    return { type: "blank" };
  }
  if (board.type === "language") return /练.*(?:表达|说话)|帮.*(?:造句|说完整)/.test(text) ? board : { type: "blank" };
  if (board.type === "english") {
    return /英语|英文|单词|word/i.test(text) && Array.isArray(board.items) &&
      board.items.length <= 3 && board.items.every(item => item && typeof item === "object" && /^#[0-9a-f]{6}$/i.test(item.color))
      ? board : { type: "blank" };
  }
  if (board.type === "math") {
    // The legacy renderer is apple-only; never present it as another object.
    const supported = /苹果|加法|减法|数数|算术/.test(text) || (previousBoard?.type === "math" && /^[\d零一二两三四五六七八九十]+[个。!！]?$/u.test(text));
    return supported && Array.isArray(board.items) && board.items.length <= 10 &&
      whole(board.crossed || 0) && (board.crossed || 0) <= board.items.length ? board : { type: "blank" };
  }
  if (board.type === "algebra" && /方程|括号|分配律|x|^\d+$/i.test(text)) return board;
  return { type: "blank" };
}
