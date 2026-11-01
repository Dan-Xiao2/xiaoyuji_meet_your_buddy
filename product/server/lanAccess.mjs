import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Opt-in access control for running the app on a home network (family pilot on a phone).
// The server spends the provider key and handles children's speech, so any non-loopback client
// must first pair with a short access code. The code is typed into a form (never put in a URL,
// where it would stay in browser history); pairing gives an HttpOnly session cookie that does
// not contain the code. Loopback clients (the developer's own browser and tests) are unaffected.
const COOKIE = "xiaoyu_lan";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const digest = value => createHash("sha256").update(String(value)).digest();

export function isLoopback(request) {
  return LOOPBACK.has(request.socket?.remoteAddress);
}

export function createLanAccess({ code, now = () => Date.now(), sessionMs = 12 * 3600_000, maxFailures = 8, lockMs = 10 * 60_000 } = {}) {
  if (typeof code !== "string" || code.length < 8) throw new Error("LAN access code must be at least 8 characters");
  const expected = digest(code);
  const sessions = new Map();
  let failures = 0, lockedUntil = 0;

  const sessionFrom = request => {
    const cookie = String(request.headers.cookie || "").split(/;\s*/).find(part => part.startsWith(`${COOKIE}=`));
    return cookie ? cookie.slice(COOKIE.length + 1) : null;
  };
  function authorized(request) {
    if (isLoopback(request)) return true;
    const id = sessionFrom(request);
    const expires = id ? sessions.get(id) : undefined;
    if (!expires) return false;
    if (expires <= now()) { sessions.delete(id); return false; }
    return true;
  }
  // Returns { ok, cookie? , reason? }. Failures are counted for all clients together: on a home
  // network a lockout is a small cost, and it stops a device on the same network from guessing.
  function pair(submitted) {
    if (now() < lockedUntil) return { ok: false, reason: "locked" };
    const ok = typeof submitted === "string" && timingSafeEqual(digest(submitted.trim()), expected);
    if (!ok) {
      failures++;
      if (failures >= maxFailures) { lockedUntil = now() + lockMs; failures = 0; }
      return { ok: false, reason: "wrong-code" };
    }
    failures = 0;
    for (const [id, expires] of sessions) if (expires <= now()) sessions.delete(id);
    const id = randomBytes(24).toString("base64url");
    sessions.set(id, now() + sessionMs);
    return { ok: true, cookie: `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(sessionMs / 1000)}` };
  }
  return { authorized, pair };
}

export function pairPage(message = "") {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>连接小宇记</title><style>body{font-family:system-ui,sans-serif;max-width:22rem;margin:3rem auto;padding:0 1rem;color:#222;background:#fff}
input,button{font:inherit;width:100%;box-sizing:border-box;padding:.7rem;margin:.4rem 0;border-radius:.5rem;border:1px solid #bbb}
button{background:#2f6f5e;color:#fff;border:0}p.note{color:#666;font-size:.9rem}p.error{color:#b00020}</style></head><body>
<h1>连接小宇记</h1><p>请输入电脑上显示的访问码。只需在这台设备上输入一次。</p>
${message ? `<p class="error" role="alert">${message}</p>` : ""}
<form method="post" action="/pair"><input name="code" autocomplete="off" autocapitalize="characters" inputmode="text" aria-label="访问码" required>
<button type="submit">连接</button></form><p class="note">这是家庭测试用的本地连接，访问码不要发给其他人。</p></body></html>`;
}
