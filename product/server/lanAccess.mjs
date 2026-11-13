import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Access control for running the app beyond this computer: a home network (family pilot on a phone)
// or a public server (docs/deployment-cn.md). The server spends the provider key and handles
// children's speech, so every client must first pair with an access code. Each family can have its
// own code (ACCESS_CODES="F1:code,F2:code"), so one family can be stopped without the others.
// The code is typed into a form (never put in a URL or browser history). Pairing gives an HttpOnly
// cookie that names the family and its expiry, signed with the server's secret: it does not contain
// the code, survives a restart when SESSION_SECRET is set, and stops working when that family's
// code is changed or removed. A loopback connection may be a proxy, so it is not a credential.
const COOKIE = "xiaoyu_lan";
const LABEL = /^[A-Za-z0-9_-]{1,20}$/;
const digest = value => createHash("sha256").update(String(value)).digest();

// "F1:ABCD2345,F2:EFGH6789" → { F1: "ABCD2345", F2: "EFGH6789" }. Throws on a malformed list, so a
// typo stops the server instead of locking a family out.
export function parseAccessCodes(value) {
  const codes = {};
  for (const entry of String(value || "").split(",").map(item => item.trim()).filter(Boolean)) {
    const [label, code, extra] = entry.split(":").map(item => item.trim());
    if (!LABEL.test(label) || codes[label] || !code || extra !== undefined) throw new Error(`ACCESS_CODES: write each family as label:code ("${label}")`);
    codes[label] = code;
  }
  return codes;
}

export function createAccess({ codes, secret = randomBytes(32).toString("hex"), now = () => Date.now(),
  sessionMs = 12 * 3600_000, maxFailures = 8, lockMs = 10 * 60_000, maxSources = 1000 } = {}) {
  const families = Object.entries(codes || {});
  if (!families.length) throw new Error("At least one access code is required");
  const seen = new Set();
  for (const [, code] of families) {
    if (typeof code !== "string" || code.length < 8) throw new Error("Access codes must be at least 8 characters");
    if (seen.has(code)) throw new Error("Each family needs its own access code");
    seen.add(code);
  }
  if (String(secret).length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  // Part of each signature: changing a family's code ends that family's sessions.
  const codeTags = new Map(families.map(([label, code]) => [label, digest(code).toString("hex").slice(0, 16)]));
  const expected = families.map(([label, code]) => [label, digest(code)]);
  const sign = (label, expires) => createHmac("sha256", secret).update(`${label}.${expires}.${codeTags.get(label)}`).digest("base64url");
  // Wrong codes are counted per source (client address, see clientAddress in server.mjs), so a
  // stranger guessing cannot lock the families out.
  const failures = new Map();

  const cookieValue = request => {
    const cookie = String(request.headers.cookie || "").split(/;\s*/).find(part => part.startsWith(`${COOKIE}=`));
    return cookie ? cookie.slice(COOKIE.length + 1) : null;
  };
  // The family label for a valid session, or null.
  function familyOf(request) {
    const [label, expiresText, signature, extra] = String(cookieValue(request) || "").split(".");
    if (extra !== undefined || !codeTags.has(label) || !signature) return null;
    const expires = parseInt(expiresText, 36);
    if (!Number.isFinite(expires) || expires <= now()) return null;
    const given = Buffer.from(signature), wanted = Buffer.from(sign(label, expiresText));
    return given.length === wanted.length && timingSafeEqual(given, wanted) ? label : null;
  }
  const authorized = request => familyOf(request) !== null;
  // Returns { ok, family?, cookie?, reason? }.
  function pair(submitted, source = "unknown") {
    const record = failures.get(source);
    if (record && now() < record.lockedUntil) return { ok: false, reason: "locked" };
    const given = digest(typeof submitted === "string" ? submitted.trim() : "");
    // Compare against every code, so the time taken does not tell which family matched.
    let family = null;
    for (const [label, code] of expected) if (timingSafeEqual(given, code) && typeof submitted === "string") family = label;
    if (!family) {
      const count = (record?.count || 0) + 1;
      if (failures.size >= maxSources) for (const [key, value] of failures) if (now() >= value.lockedUntil) failures.delete(key);
      failures.set(source, count >= maxFailures ? { count: 0, lockedUntil: now() + lockMs } : { count, lockedUntil: 0 });
      return { ok: false, reason: "wrong-code" };
    }
    failures.delete(source);
    const expires = (now() + sessionMs).toString(36);
    return { ok: true, family,
      cookie: `${COOKIE}=${family}.${expires}.${sign(family, expires)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(sessionMs / 1000)}` };
  }
  return { authorized, familyOf, pair, families: families.map(([label]) => label) };
}

// The home-network pilot (npm run pilot:lan): one code shown on the computer.
export function createLanAccess({ code, ...options } = {}) {
  if (typeof code !== "string" || code.length < 8) throw new Error("LAN access code must be at least 8 characters");
  return createAccess({ codes: { lan: code }, ...options });
}

export function pairPage(message = "") {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>连接小宇记</title><style>body{font-family:system-ui,sans-serif;max-width:22rem;margin:3rem auto;padding:0 1rem;color:#222;background:#fff}
input,button{font:inherit;width:100%;box-sizing:border-box;padding:.7rem;margin:.4rem 0;border-radius:.5rem;border:1px solid #bbb}
button{background:#2f6f5e;color:#fff;border:0}p.note{color:#666;font-size:.9rem}p.error{color:#b00020}</style></head><body>
<h1>连接小宇记</h1><p>请输入试点负责人给你的访问码。在这台设备上输入一次就可以。</p>
${message ? `<p class="error" role="alert">${message}</p>` : ""}
<form method="post" action="/pair"><input name="code" autocomplete="off" autocapitalize="characters" inputmode="text" aria-label="访问码" required>
<button type="submit">连接</button></form><p class="note">这是家庭试点用的连接，访问码不要发给其他人。</p></body></html>`;
}
