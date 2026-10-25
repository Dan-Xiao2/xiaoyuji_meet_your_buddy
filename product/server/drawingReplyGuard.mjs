// This guard runs only on ordinary chat responses, never on validated drawing-plan narration.
export function guardDrawingReply(reply, input, state = {}) {
  const text = String(reply || "");
  const request = String(input || "");
  if (/故事|童话/.test(request) || state.board?.type === "story") return { reply: text, replaced: false };
  const drawingContext = state.board?.scene?.kind === "illustration" ||
    /画|屋顶|白板|图在哪|没(?:有)?看到/.test(request) ||
    state.messages?.slice(-6).some(m => m.role !== "tutor" && /画.{0,12}(?:房子|小屋|太阳|树|云)|屋顶|[紫红蓝黄绿]色顶/.test(m.text));
  if (!drawingContext) return { reply: text, replaced: false };
  const claims = /(?:画|涂|改|擦)(?:给你看|好[了啦呀]?|完[了啦]?|出来[了啦]?)|(?:门|窗|房子|屋顶|画面|图)(?:已经|现在)?(?:变大|变小|变出来|出现)|我(?:再|已经|现在|马上)?(?:给你)?(?:画|涂|放大|缩小)|(?:门|窗|房子|屋顶|这幅画).{0,30}(?:你看|看清楚|看得清|显示出来)/;
  return claims.test(text) ? { reply: "这一步还没有改动画面。你想改哪个地方？", replaced: true } : { reply: text, replaced: false };
}
