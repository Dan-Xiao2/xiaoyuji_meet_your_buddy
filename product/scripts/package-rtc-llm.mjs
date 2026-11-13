import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

// Packages Xiaoyu's reply endpoint (server/rtcLlmServer.mjs) for an Alibaba Cloud Function Compute
// web function: one bundled file plus the knowledge cards it reads. No .env and no keys go in; the
// function's environment variables hold QWEN_API_KEY and RTC_LLM_KEY.
// Start command on the function (custom runtime, Node.js 22, Debian 11): node /code/server/rtcLlmServer.mjs
// A full path such as /var/fc/lang/nodejs22/bin/node does not exist there (tried 2026-11-10).
const out = "dist/rtc-llm";
const cards = "skills/xiaoyu-growth-companion/references/knowledge-cards.json";

rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: ["server/rtcLlmServer.mjs"], bundle: true, platform: "node", format: "esm", target: "node20",
  outfile: join(out, "server/rtcLlmServer.mjs"),
  // Bundled CommonJS packages (undici) still require Node's own modules.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }
});
mkdirSync(dirname(join(out, cards)), { recursive: true });
copyFileSync(cards, join(out, cards));
rmSync("dist/rtc-llm.zip", { force: true });
execFileSync("zip", ["-qr", "../rtc-llm.zip", "."], { cwd: out });
console.log("Packaged dist/rtc-llm.zip for Function Compute");
