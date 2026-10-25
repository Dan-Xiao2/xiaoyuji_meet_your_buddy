const AGE_PROFILES = {
  "3-4": {
    maxSentences: 2,
    maxCharacters: 100,
    instruction: "每轮 1-2 个短句，贴近眼前事物，不讲抽象定义。不必提问；确有需要才问一个具体问题，不强迫二选一。"
  },
  "4-5": {
    maxSentences: 3,
    maxCharacters: 150,
    instruction: "每轮 2-3 个短句，可以用简单的“因为、所以”和可观察的例子。不必提问，必要时最多问一个问题。"
  },
  "5-6": {
    maxSentences: 4,
    maxCharacters: 200,
    instruction: "每轮不超过 4 个短句；先回应，可以解释一个因果关系。不强行用问题结尾，给孩子自由接话的空间。"
  },
  "6-7": {
    maxSentences: 5,
    maxCharacters: 240,
    instruction: "允许稍完整的解释和比较，不必每轮追问；需要澄清时最多问一个问题。"
  }
};

export function getAgeProfile(ageBand = "4-5") {
  return AGE_PROFILES[ageBand] || AGE_PROFILES["4-5"];
}

export function getAgeInstruction(ageBand = "4-5") {
  return getAgeProfile(ageBand).instruction;
}

export function adaptTutorReply(value, ageBand = "4-5") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const profile = getAgeProfile(ageBand);
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [text];
  const selected = sentences.slice(0, profile.maxSentences);
  let result = selected.join(" ").trim();

  while (result.length > profile.maxCharacters && selected.length > 1) {
    selected.pop();
    result = selected.join(" ").trim();
  }

  if (result.length <= profile.maxCharacters) return result;
  return `${result.slice(0, profile.maxCharacters - 1).replace(/[，、；：,.!?！？。\s]+$/g, "")}。`;
}
