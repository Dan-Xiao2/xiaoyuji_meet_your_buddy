// One concrete instruction for this turn, chosen from what the child just said. General rules
// ("leave a hook, don't keep asking") were followed unevenly by the model in pilot sessions; a
// short instruction about this exact turn is followed more reliably. Plain heuristics, no model.
const strip = text => String(text || "").replace(/[\s，,。.!！~～、…]/g, "");

const ACK = /^(?:嗯+|恩+|哦+|噢+|喔+|啊+|好+|好的|对+|是+|行|知道了)$/u;
const DONT_KNOW = /(?:不知道|不晓得|不清楚|忘了|想不起来)/u;
const DONE = /^(?:没有了?|没了|不想说了?|不说了|就这样|没事了?|没什么了?)$/u;
const FEELING = /^(?:很|好|特别|超级)?(?:开心|高兴|好玩|难过|伤心|生气|害怕|怕|喜欢|不喜欢|累|无聊|好笑)(?:了|的|呀|啊|呢)?$/u;
const QUESTION = /[？?]$|为什么|为啥|怎么|是什么|什么是|哪里|多少|会不会|能不能|可不可以|吗$/u;

export const responseBoundaryInstruction = "回应边界：孩子明确拒绝某个建议或表示说完时，简短接住，不继续劝、不换成新任务或追问；这优先于留话头，不把拒绝当前建议等同结束整个会话。孩子主动提出新问题时跟随新问题。安慰时不编造他人动机、孩子的才能或经历，不用比较高低的夸奖补偿；只回应已知事实，未知就保留不确定性。";

export function classifyChildTurn(input) {
  const text = strip(input);
  if (!text) return "empty";
  if (ACK.test(text)) return "ack";
  if (DONE.test(text)) return "done";
  if (DONT_KNOW.test(text) && text.length <= 8) return "dont-know";
  if (FEELING.test(text)) return "feeling";
  if (QUESTION.test(String(input || "").trim()) || QUESTION.test(text)) return "question";
  return "share";
}

const GUIDANCE = {
  ack: "孩子只回了一声，说明在听但没有新内容：这一轮不要提问，也不要重复刚讲过的；直接说一个和当前话题相关的、新的有趣细节，让他有东西可以接。",
  "dont-know": "孩子说不知道：不追问，不考他。给一个他凭眼睛或经验就能想到的小提示，或者直接由你说出一个有趣的答案。",
  done: "孩子表示这件事说完了：不要再问这件事。简短接住，不另开话题、任务或问题，留给孩子决定是否继续。",
  feeling: "孩子只说了一个感受：用半句话接住这个感受，再问一个能让他说出具体画面的小问题（例如“最开心的是哪一下？”）。不要说自己也开心之类的表态。",
  question: "孩子在提问：先用一两句把真正的原因说清楚，配一个看得见的例子；结尾给一个他在身边就能观察或试试看的小细节，不必再提问。",
  share: "孩子在分享：先用他的词具体接住他说的那件事，再补一个他可能没注意到的有趣细节；最多问一个关于他自己经历的小问题。"
};

export function turnGuidance(input, messages = []) {
  const kind = classifyChildTurn(input);
  if (kind === "empty") return "";
  const lastTutor = [...messages].reverse().find(message => message.role === "tutor");
  const askedLastTime = /[？?][^？?]{0,4}$/u.test(String(lastTutor?.text || "").trim());
  // The rule "not two turns in a row ending with a question" was not followed as a general rule.
  const noQuestion = askedLastTime && kind !== "feeling" ? "上一轮你已经问了问题，这一轮不要以问题结尾。" : "";
  return `本轮指引：${GUIDANCE[kind]}${noQuestion}`;
}
