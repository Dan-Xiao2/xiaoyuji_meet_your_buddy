import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { resolveBrowserExecutable } from "../scripts/browser-runtime.mjs";

const chromium = { executablePath: () => "/playwright/chromium" };
const base = { chromium, override: "", platform: "linux" };

test("Linux uses Playwright-managed Chromium without a Mac installation", async () => {
  assert.equal(await resolveBrowserExecutable({ ...base, canExecute: async p => p === "/playwright/chromium" }), "/playwright/chromium");
});
test("an explicit executable wins over the managed browser", async () => {
  assert.equal(await resolveBrowserExecutable({ ...base, override: "/custom/chrome", canExecute: async () => true }), "/custom/chrome");
});
test("an invalid override fails instead of silently selecting another browser", async () => {
  await assert.rejects(resolveBrowserExecutable({ ...base, override: "/missing", canExecute: async p => p !== "/missing" }), /CHROME_PATH/);
});
test("missing browsers on Linux fail with an installation instruction", async () => {
  await assert.rejects(resolveBrowserExecutable({ ...base, canExecute: async () => false }), /playwright install chromium/);
});
test("Mac retains a local Chrome fallback when bundled Chromium is absent", async () => {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  assert.equal(await resolveBrowserExecutable({ ...base, platform: "darwin", canExecute: async p => p === chrome }), chrome);
});

const runner = fileURLToPath(new URL("../scripts/run-critical-browser-checks.mjs", import.meta.url));
test("browser check list is available without a usable browser", () => {
  const result = spawnSync(process.execPath, [runner, "--list"], { encoding: "utf8", env: { ...process.env, CHROME_PATH: "/missing-browser" } });
  assert.equal(result.status, 0, result.stderr);
  const names = result.stdout.trim().split("\n");
  assert.ok(names.includes("production-design"));
  assert.ok(names.includes("drawing-races"));
  assert.equal(new Set(names).size, names.length);
});
test("unknown or empty browser selection fails before starting a server", () => {
  for (const args of [["--only"], ["--only", "typo"], ["--list", "extra"], ["--unknown"]]) {
    const result = spawnSync(process.execPath, [runner, ...args], { encoding: "utf8", env: { ...process.env, CHROME_PATH: "/missing-browser" } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stderr, /CHROME_PATH/);
  }
});

test("an invalid test port fails before loading a browser", () => {
  for (const port of ["0", "65536", "1.5", "no-port"]) {
    const result = spawnSync(process.execPath, [runner, "--only", "production-design"], {
      encoding: "utf8", env: { ...process.env, BROWSER_TEST_PORT: port, CHROME_PATH: "/missing-browser" }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BROWSER_TEST_PORT/);
    assert.doesNotMatch(result.stderr, /CHROME_PATH/);
  }
});

async function runnerFixture(t, serverSource) {
  const root = await mkdtemp(join(tmpdir(), "xiaoyu-browser-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "server", "tests", "fake-playwright"]) await mkdir(join(root, dir));
  await copyFile(runner, join(root, "scripts/run-critical-browser-checks.mjs"));
  await copyFile(new URL("../scripts/browser-runtime.mjs", import.meta.url), join(root, "scripts/browser-runtime.mjs"));
  await writeFile(join(root, "fake-playwright/index.mjs"), "export const chromium = {};\n");
  await writeFile(join(root, "server/server.mjs"), serverSource);
  await writeFile(join(root, "tests/production-design-browser.mjs"), "process.exitCode = 1;");
  await writeFile(join(root, "tests/drawing-races-browser.mjs"), 'console.log("SECOND_FLOW_EXECUTED");');
  return port => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/run-critical-browser-checks.mjs", "--only", "production-design", "drawing-races"], {
      cwd: root,
      env: { ...process.env, BROWSER_TEST_PORT: String(port), CHROME_PATH: process.execPath, PLAYWRIGHT_MODULE: join(root, "fake-playwright") },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "", stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 15000);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("close", (status, signal) => { clearTimeout(timeout); resolve({ status, signal, stdout, stderr }); });
  });
}

const servingFixture = `import { createServer } from "node:http";
const port = Number(process.env.PORT);
createServer((req, res) => res.end("ok")).listen(port, "127.0.0.1", () => {
  console.log("小宇记 MVP is running at http://127.0.0.1:" + port);
});`;

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

test("browser runner continues after a failed flow and returns a failure summary", async t => {
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const run = await runnerFixture(t, servingFixture);
  const result = await run(port);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /SECOND_FLOW_EXECUTED/);
  assert.match(result.stdout, /1\/2 flows passed/);
  assert.match(result.stderr, /Failed flows:\ntests\/production-design-browser.mjs/);
  // Completion must release the server's port, not just send a stop signal.
  const probe = createServer();
  t.after(() => new Promise(resolve => probe.close(resolve)));
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
});

test("an occupied HTTP port must not be mistaken for this run's test server", async t => {
  let requests = 0;
  const otherServer = createServer((req, res) => { requests++; res.end("another application"); });
  const port = await listen(otherServer);
  t.after(() => new Promise(resolve => otherServer.close(resolve)));
  // The delay makes the old HTTP polling race deterministic: another service already answers.
  const run = await runnerFixture(t, 'await new Promise(resolve => setTimeout(resolve, 300));\n' + servingFixture);
  const result = await run(port);
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /SECOND_FLOW_EXECUTED|flows passed/);
  assert.equal(requests, 0, "do not probe or run tests against another application");
  assert.equal(otherServer.listening, true, "leave the existing service running");
});

test("a test server that exits before readiness starts no flows", async t => {
  const run = await runnerFixture(t, 'process.exit(2);');
  const result = await run(4197);
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /SECOND_FLOW_EXECUTED/);
  assert.match(result.stderr, /测试服务启动失败/);
});
