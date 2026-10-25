import test from "node:test";
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
