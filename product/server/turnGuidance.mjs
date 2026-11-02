// One concrete instruction for this turn; ambiguous short replies defer to recent context. General rules
// ("leave a hook, don't keep asking") were followed unevenly by the model in pilot sessions; a
// short instruction about this exact turn is followed more reliably. Plain heuristics, no model.
const strip = text => String(text || "").replace(/[\s，,。.!！~～、…]/g, "");

const ACK = /^(?:嗯+|恩+|哦+|噢+|喔+|啊+|好+|好的|对+|是+|行|知道了)$/u;
const DONT_KNOW = /(?:不知道|不晓得|不清楚|忘了|想不起来)/u;
const DONE = /^(?:不想说了?|不说了|就这样|说完了|讲完了)$/u;
const SHORT_ANSWER = /^(?:没有了?|没了|没事了?|没什么了?)$/u;
// Only direct, complete self-refusals (optionally after "不知道"). Do not search
// arbitrary clauses: a narrated/quoted character's refusal is not the child's command.
const REFUSAL = /^(?:(?:我)?(?:不知道|不晓得|不清楚))?(?:我)?(?:现在|今天|暂时|先)?(?:不想|不愿意)(?:再)?(?:说|聊|回答|讲|画|想办法|想想办法|练习|做这个)(?:了|啦|呀|啊)?$/u;
const FEELING = /^(?:很|好|特别|超级)?(?:开心|高兴|好玩|难过|伤心|生气|害怕|怕|喜欢|不喜欢|累|无聊|好笑)(?:了|的|呀|啊|呢)?$/u;
const QUESTION = /[？?]$|为什么|为啥|怎么|是什么|什么是|哪里|多少|会不会|能不能|可不可以|吗$/u;

export const responseBoundaryInstruction = "回应边界：孩子明确拒绝某个建议或表示说完时，简短接住，不继续劝、不换成新任务或追问；这优先于留话头，不把拒绝当前建议等同结束整个会话。孩子主动提出新问题时跟随新问题。安慰时不编造他人动机、孩子的才能或经历，不用比较高低的夸奖补偿；只回应已知事实，未知就保留不确定性。";

export function classifyChildTurn(input) {
  const text = strip(input);
  if (!text) return "empty";
  if (ACK.test(text)) return "ack";
  if (DONE.test(text) || REFUSAL.test(text)) return "done";
  if (SHORT_ANSWER.test(text)) return "short-answer";
  if (DONT_KNOW.test(text) && text.length <= 8) return "dont-know";
  if (FEELING.test(text)) return "feeling";
  if (QUESTION.test(String(input || "").trim()) || QUESTION.test(text)) return "question";
  return "share";
}

const GUIDANCE = {
  ack: "孩子给了简短回应：结合上一轮区分这是对问题或建议的回答，还是听解释时的附和。先接续他的意思，不重复刚讲过的；有帮助时才补一个相关细节，不自动开启新任务。",
  "short-answer": "孩子给了可能有歧义的短答：结合上一轮区分是在说物体不存在、回答某个问题，还是表示这件事说完了。不要只凭这个词判定结束；若确实说完，简短接住，不另开话题、任务或问题。",
  "dont-know": "孩子说不知道：结合上一轮判断不知道的是什么。事实问题可以直接给适量解释；感受或经历暂时说不清也可以，不替他指定感受，不考问。明确不想继续时简短接住，不补新话题。",
  done: "孩子明确拒绝当前建议或表示这件事说完了：不要再问这件事。简短接住，不另开话题、任务或问题，留给孩子决定是否继续。",
  feeling: "孩子说了一个感受：具体接住已知感受，不编造原因或经历，不要求他继续解释。若有帮助，可以回应前文的一个具体细节；不自动追问，不说自己也开心之类的表态。",
  question: "孩子在提问：先用一两句把真正的原因说清楚，有帮助时配一个看得见的例子；不必追加问题或现实任务。",
  share: "孩子在分享：先用他的词具体接住他说的那件事，有帮助时补一个相关的具体细节；只有需要时才问一个关于他自己经历的小问题。若这句其实是在纠正或拒绝，优先跟随，不按分享展开。"
};

export function turnGuidance(input, messages = []) {
  const kind = classifyChildTurn(input);
  if (kind === "empty") return "";
  const lastTutor = [...messages].reverse().find(message => message.role === "tutor");
  const askedLastTime = /[？?]/u.test(String(lastTutor?.text || "").trim());
  // The rule "not two turns in a row ending with a question" was not followed as a general rule.
  const noQuestion = askedLastTime ? "上一轮你已经问了问题，这一轮不要以问题结尾。" : "";
  return `本轮指引：${GUIDANCE[kind]}${noQuestion}`;
}
