import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const url = process.env.TEST_URL || "http://localhost:4173/design-drafts/design-system/index.html";
await mkdir("screenshots/design-system", { recursive: true });
try {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, reducedMotion: width === 768 ? "reduce" : "no-preference", acceptDownloads: true });
    const page = await context.newPage(), errors = [], apiCalls = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.route("**/api/**", route => { apiCalls.push(route.request().url()); return route.abort(); });
    await page.addInitScript(() => {
      window.draftStorageWrites = 0;
      Storage.prototype.setItem = function () { window.draftStorageWrites++; throw new Error("Draft must not save to storage"); };
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { throw new Error("Draft must not record"); };
    });
    const checkLayout = async label => {
      await page.locator("img").evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: ${label} overflow`);
      assert.ok(await page.locator("img").evaluateAll(imgs => imgs.every(img => img.complete && img.naturalWidth > 0)), `${width}: assets`);
      await page.screenshot({ path: `screenshots/design-system/${width}-${label}.png`, fullPage: true });
    };
    const navigate = async view => {
      if (width <= 900) {
        await page.locator("#menu-open").click();
        assert.equal(await page.locator("#drawer").evaluate(d => d.open), true);
        await page.locator(`#drawer-nav [data-view="${view}"]`).click();
      } else await page.locator(`#desktop-nav [data-view="${view}"]`).click();
      assert.equal(await page.locator(`#desktop-nav [data-view="${view}"]`).getAttribute("aria-current"), "page");
      assert.equal(await page.locator(`#drawer-nav [data-view="${view}"]`).getAttribute("aria-current"), "page");
    };
    await page.goto(url);
    await page.locator("#voice").waitFor();
    assert.equal(await page.locator(".paper").count(), 0);
    await checkLayout("voice-idle");
    await page.locator("#voice").click();
    assert.equal(await page.locator(".talk-stage").getAttribute("data-state"), "listening");
    const animation = await page.locator("#voice").evaluate(el => getComputedStyle(el).animationName);
    assert.equal(animation, width === 768 ? "none" : "breathe");
    await checkLayout("voice-listening");
    await page.locator("#preview-state").selectOption("thinking");
    assert.equal(await page.locator("#voice").isDisabled(), true);
    await page.locator("#preview-state").selectOption("error");
    await page.getByRole("button", { name: "重新连接", exact: true }).click();
    assert.equal(await page.locator(".talk-stage").getAttribute("data-state"), "listening");
    await page.locator("#preview-state").selectOption("drawing");
    const board = await page.locator(".paper").boundingBox(), control = await page.locator("#voice").boundingBox();
    assert.ok(control.y >= board.y + board.height, "voice must not cover drawing");
    await checkLayout("whiteboard");
    await page.locator("#voice").click();
    assert.equal(await page.locator(".paper").count(), 1, "pausing keeps whiteboard");
    assert.match(await page.locator(".board-controls").innerText(), /已暂停/);
    await page.locator("#voice").click();
    assert.equal(await page.locator(".paper").count(), 1, "continuing keeps whiteboard");
    await page.locator("#end-talk").click();
    assert.equal(await page.locator(".paper").count(), 0);
    await navigate("growth");
    assert.match(await page.locator(".chart-heading").innerText(), /4天 · 5个片段/);
    await checkLayout("growth-week");
    await page.locator('[data-bucket="0"]').click();
    assert.equal(await page.locator(".moment").count(), 1);
    assert.match(await page.locator(".moment").innerText(), /9\/3/);
    await page.locator('input[name="range"][value="30"]').check();
    assert.match(await page.locator(".chart-heading").innerText(), /5天 · 6个片段/);
    assert.equal(await page.locator(".chart button").count(), 5);
    await page.locator('input[name="range"][value="0"]').check();
    assert.equal(await page.locator(".chart button").count(), 2);
    assert.equal(await page.locator("#previous").isDisabled(), true);
    await page.locator('input[name="range"][value="7"]').check();
    await page.locator("#previous").click();
    assert.match(await page.locator(".empty").innerText(), /没有记录/);
    await page.locator("#next").click();
    assert.equal(await page.locator(".chart").count(), 1);
    for (const state of ["empty", "loading", "error"]) {
      await page.locator("#preview-state").selectOption(state);
      assert.equal(await page.locator(".chart").count(), 0);
      await checkLayout(`growth-${state}`);
    }
    await page.locator("#retry-growth").click();
    assert.equal(await page.locator(".chart").count(), 1);
    await navigate("parent");
    await page.locator("#nickname").fill("");
    await page.locator('button[type="submit"]').click();
    assert.equal(await page.locator("#nickname").getAttribute("aria-invalid"), "true");
    await page.locator("#nickname").fill("喜欢问为什么和画小汽车的安安");
    await page.locator("#save-moments").uncheck();
    await page.locator('button[type="submit"]').click();
    assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
    await page.waitForFunction(() => document.querySelector("#save-feedback").textContent.includes("已保存"));
    await checkLayout("settings");
    await page.locator("#preview-state").selectOption("error");
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    assert.equal(await page.locator("#nickname").inputValue(), "喜欢问为什么和画小汽车的安安");
    assert.match(await page.locator("#save-feedback").innerText(), /没能保存/);
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector("#save-feedback").textContent.includes("已保存"));
    await navigate("growth");
    await checkLayout("growth-long-name");
    await navigate("backup");
    const downloaded = page.waitForEvent("download");
    await page.locator("#download").click();
    assert.equal((await downloaded).suggestedFilename(), "xiaoyu-design-demo.json");
    await checkLayout("backup");
    if (width <= 900) {
      await page.locator("#menu-open").click();
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        assert.ok(await page.evaluate(() => document.querySelector("#drawer").contains(document.activeElement)), "dialog traps focus");
      }
      await checkLayout("menu");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#menu-open").evaluate(el => el === document.activeElement), true);
    }
    assert.equal(await page.evaluate(() => window.draftStorageWrites), 0);
    assert.deepEqual(apiCalls, []);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: states, dates, controls, assets, isolation, keyboard`);
    await context.close();
  }
} finally { await browser.close(); }
