// Turn-taking signals worked out from what the recogniser hears, shared by the server relay (on
// partial text, which never leaves the server) and the page (on the final text it receives).
// - isEcho: the "speech" is Xiaoyu's own reply coming back through the speaker.
// - isBackchannel: a short "嗯 / 对 / 好" while Xiaoyu speaks; it should not stop her.
// - endpointHint: whether the child sounds finished (a question) or mid-thought, so the page can
//   wait less or more than its usual silence before answering.
import { looksUnfinished } from "./utteranceCompletion.js";

const MARKS = /[\s，,。.、！!？?…~～—\-·:：;；"“”'‘’（）()]/gu;
export const normalizeSpeech = text => String(text || "").replace(MARKS, "");

const BACKCHANNEL = /^(?:[嗯唔哦噢喔啊呀哈欸诶]+|[对好是]+|行|好的|好呀|好啊|是的|对呀|对啊|知道了|然后呢)$/u;
export function isBackchannel(text) {
  const value = normalizeSpeech(text);
  return Boolean(value) && value.length <= 4 && BACKCHANNEL.test(value);
}

// Echo when most of what was heard appears, in order and close together, in what Xiaoyu is
// saying. Recognition of her voice through the speaker drops and swaps characters, so this matches
// in-order character overlap rather than exact substrings; the matches must sit within a stretch of
// the reply not much longer than what was heard, so a child's own sentence that merely shares common
// characters (我、是、也) with the reply is not mistaken for echo. One or two characters are not judged.
export function isEcho(heard, speaking) {
  const said = normalizeSpeech(heard), reply = normalizeSpeech(speaking);
  if (said.length < 3 || !reply) return false;
  if (reply.includes(said)) return true;
  for (let start = reply.indexOf(said[0]); start !== -1; start = reply.indexOf(said[0], start + 1)) {
    let at = start, matched = 0, last = start;
    for (const char of said) {
      const found = reply.indexOf(char, at);
      if (found === -1 || found - start > said.length * 2) continue;
      matched++; last = found; at = found + 1;
    }
    if (matched / said.length >= 0.75 && last - start < said.length * 2) return true;
  }
  return false;
}

// "complete" only for clear questions (…吗 / …呢 / …？): a child asking something wants a quick
// answer, and a question ending is rarely a pause mid-sentence. "unfinished" reuses the rule that
// already holds half sentences (…然后 / …因为 / …，). Anything else keeps the usual wait.
const QUESTION_END = /(?:吗|呢|吧|么|嘛)[？?。！!]?$|[？?]$/u;
export function endpointHint(text) {
  const value = String(text || "").trim();
  if (normalizeSpeech(value).length < 3) return null;
  if (looksUnfinished(value)) return "unfinished";
  if (QUESTION_END.test(value)) return "complete";
  return null;
}
