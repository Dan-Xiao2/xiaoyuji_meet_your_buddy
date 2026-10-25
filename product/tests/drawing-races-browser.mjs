import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createInitialFamily, addFamilyMember } from "../src/data/familyModel.js";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const key = "xiaoyuji-learning-state-v1";
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const failures = [];

async function fixture(width, mode, hold) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  const gates = Object.fromEntries(["route", "plan", "image"].map(name => [name, deferred()]));
  const started = Object.fromEntries(["route", "plan", "image"].map(name => [name, deferred()]));
  const state = createInitialState();
  state.uiVersion = 4;
  state.profile = { ...state.profile, name: "模拟家庭", configured: true, consent: true };
  state.family = addFamilyMember(createInitialFamily(state.profile), { name: "模拟家长", role: "mother" });
  state.session = { status: "active", id: "drawing-races", turnCount: 0 };
  state.board = resolveIllustrationPlan("画一个房子", state).board;
  await page.addInitScript(({ state, key }) => {
    localStorage.setItem(key, JSON.stringify(state));
    navigator.mediaDevices.getUserMedia = async () => { throw new Error("Synthetic test: no microphone"); };
    // Deliberately ignore cancellation for route/plan to exercise the late-result guard.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (url, options) => nativeFetch(url,
      /\/api\/whiteboard\/(route|plan)$/.test(String(url)) ? { ...options, signal: undefined } : options);
  }, { state, key });
  page.on("pageerror", error => errors.push(error.message));
  let imageCalls = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    let result = {};
    if (path === "/api/whiteboard/route") {
      if (body.input.includes("绿草地")) result = { mode: "image", operation: "edit", instruction: body.input, available: true };
      else {
        started.route.resolve();
        if (hold === "route") await gates.route.promise;
        result = { mode, operation: "edit", instruction: body.input, reply: "先保留这幅画。", available: true };
      }
    } else if (path === "/api/whiteboard/plan") {
      started.plan.resolve();
      if (hold === "plan") await gates.plan.promise;
      result = { sourceRevision: body.board.scene?.revision ?? null,
        plan: resolveIllustrationPlan("屋顶改成蓝色", { board: body.board }), llmStatus: { used: true } };
    } else if (path === "/api/whiteboard/image") {
      imageCalls++;
      started.image.resolve();
      await gates.image.promise;
      result = { ok: true, image: await page.evaluate(() => {
        const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext("2d"); ctx.fillStyle = "#93b69b"; ctx.fillRect(0, 0, 32, 32);
        return canvas.toDataURL("image/png");
      }) };
    } else if (path === "/api/tutor/quick") result = { reply: "我们接着聊。", llmStatus: { used: true } };
    else if (path === "/api/tutor") result = { ...body.state, growthEvidence: { shouldSave: false } };
    try { await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) }); } catch {}
  });
  await page.goto(process.env.TEST_URL || "http://localhost:4197/");
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await page.evaluate(() => { document.querySelector("#speakReplies").checked = false; });
  const send = text => page.evaluate(text => {
    document.querySelector("#childInput").value = text;
    document.querySelector("#askForm").requestSubmit();
  }, text);
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const waitTurns = count => page.waitForFunction(({ key, count }) => JSON.parse(localStorage.getItem(key)).session.turnCount === count, { key, count });
  return { context, page, errors, gates, started, send, read, waitTurns,
    caregiver: state.family.members.find(member => member.role !== "child"), imageCalls: () => imageCalls };
}

async function run(width, name, mode, hold, check) {
  const f = await fixture(width, mode, hold);
  let timer;
  try {
    await Promise.race([check(f), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Drawing race scenario timed out after 45s")), 45000);
    })]);
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow");
    assert.deepEqual(f.errors, []);
    console.log(`PASS ${width}px: ${name}`);
  } catch (error) {
    failures.push(`${width}px ${name}: ${error.message}`);
    console.error(`FAIL ${width}px: ${name}: ${error.message}`);
  } finally {
    clearTimeout(timer);
    Object.values(f.gates).forEach(gate => gate.resolve());
    await f.context.close();
  }
}

try {
  for (const width of [390, 1440]) {
    for (const [mode, stage] of [["precise", "route"], ["precise", "plan"], ["chat", "route"], ["image", "route"], ["clarify", "route"]]) await run(width, `${mode}/${stage} preserves edited family`, mode, stage, async f => {
      await f.send("把门变大"); await f.started[stage].promise;
      await f.page.evaluate(() => {
        document.querySelector("#profileForm").elements.studentName.value = "绘画等待时的新昵称";
        document.querySelector("#profileForm").requestSubmit();
      });
      await f.page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).profile.name === "绘画等待时的新昵称", key);
      await f.page.selectOption("#activeSpeaker", f.caregiver.id);
      f.gates[stage].resolve(); await f.waitTurns(1);
      if (mode === "chat") await f.page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).llmStatus.stage === "complete", key);
      const saved = await f.read();
      assert.equal(saved.profile.name, "绘画等待时的新昵称");
      assert.equal(saved.family.activeSpeakerId, f.caregiver.id);
      assert.equal(saved.studentModel.profile.nickname, "绘画等待时的新昵称");
      if (mode === "precise") assert.equal(saved.board.scene.objects[0].roofColor, "#87bbc9");
    });
    for (const [mode, stage] of [["clarify", "route"], ["chat", "route"], ["image", "route"], ["precise", "plan"]]) {
      await run(width, `new image survives late ${mode}`, mode, stage, async f => {
        await f.send("给房子加上绿草地"); await f.started.image.promise; await f.waitTurns(1);
        await f.send("把门变大"); await f.started[stage].promise;
        f.gates.image.resolve(); await f.page.locator(".generated-image img").waitFor();
        const picture = (await f.read()).board;
        f.gates[stage].resolve(); await f.waitTurns(2);
        const saved = await f.read();
        assert.ok(JSON.stringify(saved.board) === JSON.stringify(picture), "Late result replaced the newer image");
        assert.equal(f.imageCalls(), 1, "A stale edit must not create another paid image request");
        assert.equal(saved.drawingRequest, null, "The old drawing request must not be revived");
        if (mode === "image" || mode === "precise") assert.match(saved.messages.at(-1).text, /画面.*更新/);
      });
    }
    for (const stage of ["route", "plan"]) for (const action of ["end", "new-turn", "undo", "cancel"]) await run(width, `${action} rejects late ${stage}`, "precise", stage, async f => {
      await f.send("把门变大"); await f.started[stage].promise;
      if (action === "end") await f.page.locator("#endChildSession").click();
      else {
        await f.send({ "new-turn": "屋顶改成紫色", undo: "撤销", cancel: "取消画画" }[action]);
        await f.waitTurns(1);
      }
      const ended = await f.read();
      const response = f.page.waitForResponse(r => r.url().endsWith(`/api/whiteboard/${stage}`));
      f.gates[stage].resolve(); await (await response).finished();
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const saved = await f.read();
      assert.equal(saved.session.status, ended.session.status);
      assert.equal(saved.session.turnCount, ended.session.turnCount);
      assert.deepEqual(saved.board, ended.board);
      assert.deepEqual(saved.messages, ended.messages);
      assert.equal(f.imageCalls(), 0);
    });
  }
} finally { await browser.close(); }
assert.deepEqual(failures, [], "Drawing race regressions");
