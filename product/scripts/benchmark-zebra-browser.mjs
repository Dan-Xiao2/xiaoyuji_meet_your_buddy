import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily } from "../src/data/familyModel.js";
import { imageBoard } from "../src/whiteboard/openDrawing.js";

if (!process.argv.includes("--allow-paid-synthetic")) throw new Error("Explicit paid test approval required");
const folder = fileURLToPath(new URL("../screenshots/zebra-live-2026-10-05/", import.meta.url));
await mkdir(folder, { recursive: true });
const ledger = folder + "results.json";
let results = [];
try { results = JSON.parse(await readFile(ledger, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const verifyEdit = process.argv.includes("--verify-edit-fix");
if (results.length && !(verifyEdit && results.length === 4 && results.every(r => r.ok))) throw new Error("Existing paid run: inspect ledger before authorizing another run");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const state = createInitialState(); state.uiVersion = 4;
  state.profile = { ...state.profile, name: "模拟家庭", configured: true, consent: true };
  state.family = createInitialFamily(state.profile);
  state.session = { status: "active", id: "zebra-synthetic", turnCount: 0 };
  if (verifyEdit) state.board = imageBoard("data:image/jpeg;base64," + (await readFile(folder + "3.jpg")).toString("base64"), { type: "blank" }, "蓝色条纹的斑马，右边有一个红色气球");
  await page.addInitScript(s => {
    if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(s));
    navigator.mediaDevices.getUserMedia = async () => { throw new Error("Synthetic test: no microphone"); };
  }, state);
  let current;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/whiteboard/route") {
      const response = await route.fetch({ timeout: 15000 });
      current.route = await response.json();
      await route.fulfill({ response }); return;
    }
    if (path === "/api/whiteboard/image") {
      if (results.length >= 6) { await route.abort(); return; }
      const body = route.request().postDataJSON();
      Object.assign(current, { operation: body.operation, instruction: body.instruction, inputBytes: body.image?.length || 0, status: "dispatched" });
      results.push(current);
      await writeFile(ledger, JSON.stringify(results, null, 2));
      const start = Date.now();
      const response = await route.fetch({ timeout: 75000 });
      const data = await response.json();
      Object.assign(current, { ok: data.ok, reason: data.reason, providerMs: Date.now() - start, status: "returned" });
      await writeFile(ledger, JSON.stringify(results, null, 2));
      await route.fulfill({ response }); return;
    }
    // Only synthetic drawing route/image use live APIs; no speech or unrelated tutor calls.
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.goto("http://localhost:4173/");
  await page.evaluate(() => { document.querySelector("#speakReplies").checked = false; });
  const cases = verifyEdit ? ["去掉红色气球，只保留斑马，其他地方不变。", "把斑马的蓝色条纹改成黑色，白色区域不变，不要添加任何东西。"] : ["画一只斑马，白色背景，旁边没有其他东西。", "只把斑马的黑色条纹改成蓝色，其他地方保持不变。", "在斑马右边加一个红色气球，其他地方保持不变。", "去掉红色气球，只保留斑马，其他地方不变。"];
  let previous = verifyEdit ? state.board.image : "";
  for (const input of cases) {
    current = { input, startedAt: new Date().toISOString() };
    const start = Date.now();
    console.log(JSON.stringify({ input, status: "started" }));
    await page.evaluate(text => { document.querySelector("#childInput").value = text; document.querySelector("#askForm").requestSubmit(); }, input);
    await page.waitForFunction(old => {
      const img = document.querySelector(".generated-image img");
      return img?.complete && img.naturalWidth > 0 && img.src !== old;
    }, previous, { timeout: 90000 });
    current.visibleMs = Date.now() - start;
    previous = await page.locator(".generated-image img").getAttribute("src");
    const file = `${results.length}.jpg`;
    await writeFile(folder + file, Buffer.from(previous.split(",")[1], "base64"));
    current.file = file;
    assert.ok(await page.locator(".generated-image img").isVisible());
    await page.screenshot({ path: folder + `${results.length}-mobile.png` });
    await writeFile(ledger, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(current));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.ok(await page.locator(".generated-image img").isVisible());
  await page.screenshot({ path: folder + "desktop.png" });
  assert.deepEqual(errors, []);
  console.log("Real image rendering verified at 390px and 1440px; inspect files for semantic quality.");
} finally { await browser.close(); }
