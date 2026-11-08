// Family-pilot measurements in the real page: a real turn records its timing into the pilot log,
// survives a reload, and the exported file holds timings only, never what was said.
import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const said = "虚构测试：蜗牛为什么慢慢爬";
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = createInitialState();
  state.uiVersion = 4;
  state.profile = { ...state.profile, name: "虚构试点家庭", ageBand: "4-5", configured: true, consent: true, consentVersion: 2 };
  state.session = { id: "pilot-log-test", status: "active", turnCount: 0 };
  await page.addInitScript(initial => {
    if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(initial));
  }, state);
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith("/api/speech")) return route.fulfill({ status: 503, body: "Synthetic speech failure" });
    const body = pathname === "/api/whiteboard/route" ? { mode: "chat" }
      : pathname === "/api/tutor/quick" ? { reply: "因为蜗牛用一只脚慢慢滑。", llmStatus: { used: true } }
      : pathname === "/api/tutor" ? { ...route.request().postDataJSON().state, board: { type: "blank" }, growthEvidence: { shouldSave: false }, llmStatus: { used: true } }
      : {};
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:4197/");
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await page.evaluate(() => { document.querySelector("#speakReplies").checked = false; });
  await page.evaluate(text => { document.querySelector("#childInput").value = text; document.querySelector("#askForm").requestSubmit(); }, said);
  const read = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("xiaoyuji-pilot-log-v1") || "[]"));
  await page.waitForFunction(() => (sessionStorage.getItem("xiaoyuji-pilot-log-v1") || "").includes("quick-reply"));
  assert.equal(JSON.stringify(await read()).includes("蜗牛"), false, "the pilot log must not contain what was said");

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  assert.ok((await read()).some(entry => entry.stage === "quick-reply"), "measurements survive a reload during a test");

  const [download] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => document.querySelector("[data-pilot-export]").click())]);
  assert.match(download.suggestedFilename(), /^小宇记-测试数据-\d{12}\.json$/);
  const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(exported.kind, "pilot-measurements");
  assert.equal(exported.summary.stages["quick-reply"].count, 1);
  for (const forbidden of ["蜗牛", "虚构试点家庭", "Mozilla"]) assert.equal(JSON.stringify(exported).includes(forbidden), false, `export must not contain ${forbidden}`);

  await page.evaluate(() => document.querySelector("[data-pilot-clear]").click());
  assert.deepEqual(await read(), []);
  assert.deepEqual(errors, []);
  console.log("PASS pilot log: real turn recorded, survives reload, export has timings only, clear empties it");
  await context.close();
} finally {
  await browser.close();
}
