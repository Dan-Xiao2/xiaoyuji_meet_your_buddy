import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createInitialState } from "../src/data/studentModel.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
await mkdir("screenshots/microphone-settings", { recursive: true });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => {
      requests.push(new URL(route.request().url()).pathname);
      return route.fulfill({ contentType: "application/json", body: "{}" });
    });
    const state = createInitialState(); state.uiVersion = 4;
    state.profile = { ...state.profile, name: "测试家庭", configured: true, consent: true };
    await page.addInitScript(state => {
      if (!localStorage.getItem("xiaoyuji-learning-state-v1")) localStorage.setItem("xiaoyuji-learning-state-v1", JSON.stringify(state));
      window.micTest = { calls: [], tracks: [], contexts: [], fail: "", pending: false, revoked: [] };
      const devices = navigator.mediaDevices;
      devices.enumerateDevices = async () => [
        { kind: "audioinput", deviceId: "default", label: "默认" },
        { kind: "audioinput", deviceId: "built-in", label: "MacBook Pro 麦克风" },
        { kind: "audioinput", deviceId: "phone", label: "iPhone 麦克风" }
      ];
      devices.getUserMedia = async constraints => {
        micTest.calls.push(constraints);
        if (micTest.fail) throw new DOMException("test failure", micTest.fail);
        const source = new AudioContext(); await source.resume(); micTest.contexts.push(source);
        const output = source.createMediaStreamDestination();
        const oscillator = source.createOscillator(); oscillator.connect(output); oscillator.start();
        const track = output.stream.getAudioTracks()[0]; micTest.tracks.push(track);
        const id = constraints.audio.deviceId?.exact || "phone";
        Object.defineProperty(track, "label", { value: id === "built-in" ? "MacBook Pro 麦克风" : "iPhone 麦克风" });
        track.getSettings = () => ({ deviceId: id });
        if (micTest.pending) await new Promise(resolve => { micTest.resolve = resolve; });
        return output.stream;
      };
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = url => { micTest.revoked.push(url); revoke(url); };
    }, state);
    const nav = async action => {
      if (width <= 900) await page.locator("#mobileMenuButton").click();
      await page.locator(`[data-nav-action="${action}"]:visible`).click();
    };
    await page.goto(process.env.TEST_URL || "http://localhost:4173/");
    await nav("parent");
    const panel = page.locator("#microphoneSettings");
    await panel.locator("summary").click();
    await page.waitForFunction(() => document.querySelector('#microphoneSettings select option[value="built-in"]'));
    assert.equal(await page.evaluate(() => micTest.calls.length), 0, "opening settings must not request microphone");
    await panel.locator("select").selectOption("built-in");
    const snapshot = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    await panel.locator("[data-mic-record]").click();
    await page.waitForFunction(() => document.querySelector('[data-mic-status]').textContent.includes("正在录音"));
    assert.match(await panel.locator("[data-mic-actual]").innerText(), /MacBook Pro/);
    assert.deepEqual(await page.evaluate(() => micTest.calls.at(-1).audio.deviceId), { exact: "built-in" });
    await page.waitForTimeout(350);
    await panel.locator("[data-mic-stop]").click();
    await panel.locator("audio").waitFor({ state: "visible" });
    const audioResult = await panel.locator("audio").evaluate(async audio => {
      await audio.play(); return { playing: !audio.paused, src: audio.src };
    });
    assert.equal(audioResult.playing, true); assert.match(audioResult.src, /^blob:/);
    assert.equal(await page.evaluate(() => micTest.tracks.every(track => track.readyState === "ended")), true);
    assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))), snapshot, "test audio must not persist");
    await panel.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `screenshots/microphone-settings/${width}.png`, fullPage: true });
    await panel.locator("[data-mic-clear]").click();
    assert.equal(await panel.locator("audio").getAttribute("src"), null);
    assert.ok(await page.evaluate(() => micTest.revoked.length > 0));
    // Cancellation while permission is pending must release the eventual stream.
    await page.evaluate(() => { micTest.pending = true; });
    await panel.locator("[data-mic-record]").click();
    await page.waitForFunction(() => Boolean(micTest.resolve));
    await nav("growth");
    await page.evaluate(() => { micTest.pending = false; micTest.resolve(); });
    await page.waitForFunction(() => micTest.tracks.every(track => track.readyState === "ended"));
    await nav("parent");
    await page.evaluate(() => { micTest.fail = "NotAllowedError"; });
    await panel.locator("[data-mic-record]").click();
    await page.waitForFunction(() => document.querySelector('[data-mic-status]').textContent.includes("权限"));
    await page.evaluate(() => { micTest.fail = "NotFoundError"; });
    await panel.locator("[data-mic-record]").click();
    await page.waitForFunction(() => document.querySelector('[data-mic-status]').textContent.includes("重新选择"));
    await page.evaluate(() => { micTest.fail = ""; });
    await panel.locator("[data-mic-record]").click();
    await page.waitForFunction(() => document.querySelector('[data-mic-status]').textContent.includes("正在录音"));
    await page.evaluate(() => micTest.tracks.at(-1).dispatchEvent(new Event("ended")));
    await page.waitForFunction(() => document.querySelector('[data-mic-status]').textContent.includes("断开"));
    assert.equal(await page.evaluate(() => micTest.tracks.every(track => track.readyState === "ended")), true);
    await panel.locator("[data-mic-record]").click();
    await page.waitForFunction(() => document.querySelector('[data-mic-status]').textContent.includes("正在录音"));
    await panel.locator("summary").click();
    await page.waitForFunction(() => micTest.tracks.every(track => track.readyState === "ended"));
    assert.equal(await panel.locator("audio").getAttribute("src"), null);
    assert.ok(requests.every(url => url === "/api/voice-status"), JSON.stringify(requests));
    assert.deepEqual(errors, []);
    await page.reload(); await nav("parent"); await panel.locator("summary").click();
    await page.waitForFunction(() => document.querySelector('#microphoneSettings select').value === "built-in");
    const input = await page.evaluate(async () => {
      const { createVoiceController } = await import("/src/services/voiceService.js");
      const voice = createVoiceController();
      try {
        return await new Promise((resolve, reject) => voice.listen({ preferRecorder: true,
          onStart: details => resolve({ label: details.inputLabel, constraints: micTest.calls.at(-1) }), onError: reject }));
      } finally { voice.stopListening(); }
    });
    assert.equal(input.label, "MacBook Pro 麦克风");
    assert.deepEqual(input.constraints.audio.deviceId, { exact: "built-in" });
    if (width === 390) {
      await panel.locator("[data-mic-record]").click();
      await panel.locator("audio").waitFor({ state: "visible", timeout: 12000 });
      assert.equal(await page.evaluate(() => micTest.tracks.every(track => track.readyState === "ended")), true);
      await nav("growth");
      assert.equal(await panel.locator("audio").getAttribute("src"), null);
    }
    assert.ok(requests.every(url => url === "/api/voice-status"), JSON.stringify(requests));
    console.log(`PASS ${width}: exact input, local playback, no upload/archive, cancellation, denial, missing device, cleanup, reload`);
    await context.close();
  }
} finally { await browser.close(); }
