import { safeConversationMessages } from "../../services/safety.js";

// Context for the speech recogniser (see realtimeAsr.js): the companion's name, which is otherwise
// heard as the commoner 小雨, plus recent conversation text with the same safety filter as the model
// history (at most 500 characters, newest kept). Verified live: 小雨你好 → 小宇你好.
export function recognitionCorpus(messages = []) {
  const recent = safeConversationMessages(messages).filter(message => ["child", "tutor"].includes(message.role))
    .slice(-6).map(message => String(message.text || "")).join("\n").slice(-500);
  return recent ? `小宇\n${recent}` : "小宇";
}
