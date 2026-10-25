export function normalizeParentPin(value) {
  const pin = String(value || "").trim();
  return /^\d{4}$/.test(pin) ? pin : "";
}

export async function hashParentPin(value) {
  const pin = normalizeParentPin(value);
  if (!pin) return "";
  if (globalThis.crypto?.subtle && globalThis.TextEncoder) {
    const data = new TextEncoder().encode(`xiaoyuji-parent:${pin}`);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `local-${[...pin].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 17).toString(16)}`;
}

export async function verifyParentPin(value, expectedHash) {
  if (!expectedHash) return true;
  const actualHash = await hashParentPin(value);
  return Boolean(actualHash) && actualHash === expectedHash;
}
