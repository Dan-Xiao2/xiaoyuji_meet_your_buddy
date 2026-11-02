const compact = input => String(input || "").replace(/[\s，,。.!！?？、]/g, "");

export const explorationInstruction = [
  "跟随孩子的探索，不要求分享、提问、纠正、换题依次发生。分享发现时具体回应，提问时先简短回答，不能只反问孩子猜答案。",
  "孩子纠正时先用一句话确认新的对象，必要时承认刚才理解错了。旧对象的原因猜测一并作废，不把旧原因套到新对象上，不立刻列原因或再追问。纠正不是新的能力或兴趣结论。",
  "换话题后回应新问题，不拉回旧画面、历史兴趣或课程；代词确实不明才问一句。不强制追问、选颜色、安排活动或生成记录。",
  "本接口只收到文字或语音转写，没有收到孩子的照片。可以回应孩子描述的发现，但不能说已经看见、识别图片或开启摄像头；不索要照片。",
  "普通分享和提问不主动提议画画、选颜色或启动练习；白板能力是被明确请求时才使用的工具，不是聊天的固定下一步。",
  "回应具体发现，不用固定的‘哇，真棒、真厉害’开头。不替孩子预设开心或难过，不通过反复提问延长聊天。",
  "孩子表示停止时简短收尾，不索要下次承诺、不追问、不制造情感压力。"
].join("\n");

export function conversationEndReply(input) {
  const text = compact(input).replace(/小[宇雨语]/g, "");
  // Only complete, explicit utterances stop recording; quoted words and drawing stops do not.
  const closing = /^(?:好|好的|嗯|那)?(?:(?:(?:今天|这次)?(?:就|先)?(?:聊到这里|到这里|不聊了)|(?:我)?(?:不想聊了|不聊了)|结束(?:聊天|对话)|停止(?:聊天|对话))(?:吧|了)?(?:再见|拜拜)?|(?:再见|拜拜)(?:啦|了|吧)?|我要去(?:吃饭|睡觉|玩|找妈妈|找爸爸)了(?:再见|拜拜))$/;
  return closing.test(text) ? "好，今天先聊到这里。再见。" : null;
}

export function isTopicChange(input) {
  return /^(?:小[宇雨语][，,\s]*)?(?:我们|我|那|先)?(?:换(?:一)?个话题|不聊[^，,。！？]{1,20}了[，,])/.test(String(input || "").trim());
}

export function topicChangeDrawingInput(input) {
  if (!isTopicChange(input)) return null;
  const request = String(input).trim().replace(/^(?:小[宇雨语][，,\s]*)?(?:我们|我|那|先)?(?:换(?:一)?个话题|不聊[^，,。！？]{1,20}了[，,])[，,。\s]*/, "");
  return /^(?:(?:请|帮我|给我|我想|我要|你|先|再|能不能))*画/.test(request) ? request : null;
}

export function isDrawingRetry(input) {
  return /^(?:不用了|不要问了|别问了|好|好的|嗯)?(?:你|请你|请|那就|就)?(?:直接画|画吧|开始画|继续画|再试一次|重试)(?:吧|啊|呀|啦)?$/.test(compact(input));
}

export function conversationControlReply(input) {
  const ending = conversationEndReply(input);
  if (ending) return ending;
  const text = compact(input).replace(/小[宇雨语]/g, "");
  if (/^(?:你好|哈喽|hello|hi)*(?:你|现在|可以|能|听|到|见|得|我|说话|声音|吗|么|不|清楚|还|有没有)+$/i.test(text) && /听/.test(text))
    return "我收到你这句话了。";
  if (/^(?:你好|哈喽|hello|hi)+$/i.test(text)) return "你好，我在。";
  return null;
}

export function isInteractionControl(input) {
  const text = compact(input);
  return Boolean(conversationControlReply(input)) || isDrawingRetry(input) ||
    /^(?:嗯+|恩+|好|好的|好呀|对|对呀|可以|行|谢谢|不用了|不要了|不用画了|不要画了|别画了|停止画画|取消画画|撤销|退回上一步)$/.test(text) ||
    /^(?:我|还是|我还是)?(?:没有看到|没看到|看不到|看不见)(?:画|图|画面|图片)?$/.test(text) ||
    /^(?:图|画|图片)(?:在哪|在哪里|怎么没出来)(?:里|呢)?$/.test(text);
}

export function isLessonAnswer(input, lesson) {
  if (!lesson?.awaitingAnswer) return false;
  const text = String(input).trim();
  if (/为什么|故事|今天|换个|不想|不要|画|太阳|房子/.test(text)) return false;
  if (lesson.activity === "algebra") return /x\s*=|展开.*\d|\d\s*x\s*[+\-]/i.test(text) || /^[-\d./]+$/.test(text);
  return /^(?:是|还剩|剩下|我觉得是)?\s*(?:\d+(?:\.\d+)?|[零一二两三四五六七八九十]+)\s*(?:个|块)?[。！!？?]?$/.test(text);
}
