import { spawn } from "node:child_process";
import { join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveBrowserExecutable } from "./browser-runtime.mjs";

const port = Number(process.env.BROWSER_TEST_PORT || 4197);
const testUrl = `http://127.0.0.1:${port}/`;
const requestedPlaywrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const playwrightModule = isAbsolute(requestedPlaywrightModule)
  ? pathToFileURL(join(requestedPlaywrightModule, "index.mjs")).href
  : requestedPlaywrightModule;
const tests = [
  "tests/archive-recovery-browser.mjs",
  "tests/archive-durability-browser.mjs",
  "tests/production-design-browser.mjs",
  "tests/conversation-consistency-browser.mjs",
  "tests/conversation-candidate-browser.mjs",
  "tests/runtime-state-browser.mjs",
  "tests/exploration-pipeline-browser.mjs",
  "tests/pilot-log-browser.mjs",
  "tests/child-safety-browser.mjs",
  "tests/drawing-browser.mjs",
  "tests/whiteboard-browser.mjs",
  "tests/open-drawing-browser.mjs",
  "tests/drawing-races-browser.mjs",
  "tests/interaction-stop-browser.mjs"
];

let chromium;
try {
  ({ chromium } = await import(playwrightModule));
} catch {
  throw new Error("浏览器检查需要 Playwright。请设置 PLAYWRIGHT_MODULE，或在项目中安装 playwright。");
}
const chromePath = await resolveBrowserExecutable({ chromium });

const environment = {
  ...process.env,
  PORT: String(port),
  HOST: "127.0.0.1",
  TEST_URL: testUrl,
  PLAYWRIGHT_MODULE: playwrightModule,
  CHROME_PATH: chromePath,
  TUTOR_ENABLE_LLM: "false",
  IMAGE_DRAWING_ENABLED: "false"
};
const server = spawn(process.execPath, ["server/server.mjs"], { env: environment, stdio: ["ignore", "ignore", "inherit"] });

try {
  await waitForServer(testUrl, server);
  for (const testFile of tests) await run(process.execPath, [testFile], environment);
  console.log(`Critical browser checks passed (${tests.length} flows).`);
} finally {
  server.kill("SIGTERM");
}

async function waitForServer(url, processHandle) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (processHandle.exitCode !== null) throw new Error("测试服务启动失败。");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("等待测试服务超时。");
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${args[0]} failed with exit code ${code}`)));
    child.on("error", reject);
  });
}
