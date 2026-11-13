import { createServer } from "node:http";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./env.mjs";
import { installKeepAliveDispatcher } from "./httpKeepAlive.mjs";
import { RTC_LLM_PATH, handleRtcChatCompletions, rtcLlmEnabled } from "./rtcLlm.mjs";

// A separate process with only Xiaoyu's reply endpoint for Alibaba Cloud's voice agent, so that
// whatever makes it public exposes nothing else of the app. Locally it listens on this computer only.
// On Function Compute (a web function, packaged by scripts/package-rtc-llm.mjs) it listens on the
// function's port and the HTTPS trigger is what the agent calls; the agent and the reply then stay
// in the same cloud, not a round trip to the developer's computer abroad. Requires RTC_LLM_KEY, the
// key also set in the agent's LLM node.
const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
loadLocalEnv(root);
installKeepAliveDispatcher();

const onFunctionCompute = Boolean(process.env.FC_FUNCTION_NAME);
const port = Number(process.env.FC_SERVER_PORT || process.env.RTC_LLM_PORT || (onFunctionCompute ? 9000 : 4180));
const host = onFunctionCompute ? "0.0.0.0" : "127.0.0.1";

export const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (request.method === "POST" && pathname === RTC_LLM_PATH) {
    handleRtcChatCompletions(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
    return;
  }
  // For checking a deployment from a browser: says only whether the keys are set, never what they are.
  // A Bailian key starts with "sk-"; anything else (such as a label pasted as the value) cannot work.
  if (request.method === "GET" && pathname === "/rtc/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: true, keyConfigured: rtcLlmEnabled(), modelKeyLooksValid: /^sk-\S{16,}$/.test(process.env.QWEN_API_KEY || ""), build: "2026-11-11a" }));
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("not found");
});
// Function Compute keeps connections alive between calls; Node's own idle timeouts would cut them.
if (onFunctionCompute) { server.keepAliveTimeout = 0; server.timeout = 0; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!rtcLlmEnabled()) {
    console.error("Set RTC_LLM_KEY (in .env, or the function's environment variables) before starting; the same key goes into the agent's LLM node.");
    process.exit(1);
  }
  server.listen(port, host, () => console.log(`小宇 reply endpoint for the RTC agent: http://${host}:${port}${RTC_LLM_PATH}`));
}
