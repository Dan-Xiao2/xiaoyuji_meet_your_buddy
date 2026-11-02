// Children pause mid-sentence ("其实，嗯，……"). About a second of silence ends a capture, so a
// half sentence used to get an answer while the child was still thinking (seen on an iPhone).
// A transcript that clearly stops mid-thought is held and the child is listened to again.
// Deliberately narrow: a false "unfinished" only delays an answer by a few seconds, but words
// that also end complete sentences (那个, 这个, 啊) are not treated as unfinished.
const TRAILING_PAUSE = /[，,、…]+$/u;
const TRAILING_WORD = /(?:嗯|呃|额|然后|就是|还有|因为|所以|但是|可是|而且|或者|和|跟)$/u;

export function looksUnfinished(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (TRAILING_PAUSE.test(value)) return true;
  if (/[？?！!]$/u.test(value)) return false;
  return TRAILING_WORD.test(value.replace(/[。.\s]+$/u, ""));
}

// Joins a held fragment and what the child said next, keeping a pause mark between them.
export function joinUtterance(held, next) {
  const first = String(held || "").trim().replace(/[。.]+$/u, "");
  const second = String(next || "").trim();
  if (!first) return second;
  if (!second) return first;
  return /[，,、…]$/u.test(first) ? `${first}${second}` : `${first}，${second}`;
}
