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
const allTests = [
  "tests/archive-recovery-browser.mjs",
  "tests/archive-durability-browser.mjs",
  "tests/production-design-browser.mjs",
  "tests/conversation-consistency-browser.mjs",
  "tests/conversation-candidate-browser.mjs",
  "tests/runtime-state-browser.mjs",
  "tests/exploration-pipeline-browser.mjs",
  "tests/pilot-log-browser.mjs",
  "tests/barge-in-browser.mjs",
  "tests/streaming-reply-browser.mjs",
  "tests/asr-capture-browser.mjs",
  "tests/child-safety-browser.mjs",
  "tests/drawing-browser.mjs",
  "tests/whiteboard-browser.mjs",
  "tests/open-drawing-browser.mjs",
  "tests/drawing-races-browser.mjs",
  "tests/interaction-stop-browser.mjs"
];

const names = allTests.map(file => file.replace("tests/", "").replace("-browser.mjs", ""));
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--list") {
  console.log(names.join("\n"));
  process.exit(0);
}
if (args.length && (args[0] !== "--only" || args.length < 2 || args.slice(1).some(name => !names.includes(name)))) {
  console.error("Usage: npm run check:browser -- --list | --only <name> [name...] (see --list)");
  process.exit(1);
}
const tests = args.length ? allTests.filter((_, index) => args.slice(1).includes(names[index])) : allTests;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("BROWSER_TEST_PORT 必须是 1–65535 的整数。");

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
const server = spawn(process.execPath, ["server/server.mjs"], { env: environment, stdio: ["ignore", "pipe", "inherit"] });
server.stdout.setEncoding("utf8");
const serverExited = new Promise(resolve => {
  server.once("close", resolve);
  server.once("error", resolve);
});

try {
  await waitForServer(server, `小宇记 MVP is running at ${testUrl.slice(0, -1)}`);
  const failures = [];
  for (const testFile of tests) {
    try { await run(process.execPath, [testFile], environment); }
    catch (error) {
      failures.push(testFile);
      console.error(error.message);
    }
  }
  console.log(`Browser checks: ${tests.length - failures.length}/${tests.length} flows passed.`);
  if (failures.length) {
    console.error(`Failed flows:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
} finally {
  const forceStop = setTimeout(() => server.kill("SIGKILL"), 3000);
  forceStop.unref();
  if (server.exitCode === null && server.signalCode === null) server.kill("SIGTERM");
  await serverExited;
  clearTimeout(forceStop);
}

// Only this child's listen callback proves ownership; an HTTP 200 on the port could be another app.
function waitForServer(processHandle, readyLine) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => finish(new Error("等待测试服务就绪超时。")), 5000);
    function finish(error) {
      clearTimeout(timeout);
      processHandle.stdout.off("data", onData);
      processHandle.off("exit", onExit);
      processHandle.off("error", onError);
      error ? reject(error) : resolve();
    }
    function onData(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      if (lines.some(line => line.trim() === readyLine)) finish();
    }
    function onExit(code, signal) { finish(new Error(`测试服务启动失败（${signal || code}）。`)); }
    function onError(error) { finish(new Error(`测试服务启动失败：${error.message}`)); }
    processHandle.stdout.on("data", onData);
    processHandle.once("exit", onExit);
    processHandle.once("error", onError);
  });
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`${args[0]} failed with exit code ${code}`)));
    child.on("error", reject);
  });
}
