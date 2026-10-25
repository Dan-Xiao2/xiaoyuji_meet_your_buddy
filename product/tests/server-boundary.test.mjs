import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { server } from "../server/server.mjs";

let origin;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("only intentional browser assets are public", async () => {
  for (const path of [
    "/", "/src/app.js", "/assets/xiaoyu-planet.png",
    "/node_modules/lucide/dist/umd/lucide.min.js",
    "/docs/architecture/xiaoyuji-runtime.architecture.html"
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
  }
});

test("private project files cannot be downloaded", async () => {
  for (const path of ["/.env", "/.git/config", "/server/server.mjs", "/package.json", "/AGENTS.md", "/supabase/schema.sql"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("cache-control"), "no-store", path);
  }
});

test("API calls require same-origin JSON requests", async () => {
  const missingOrigin = await fetch(origin + "/api/tutor", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
  });
  assert.equal(missingOrigin.status, 403);

  const wrongType = await fetch(origin + "/api/tutor", {
    method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: "{}"
  });
  assert.equal(wrongType.status, 415);
  assert.equal((await wrongType.json()).reason, "json-required");

  const invalidJson = await fetch(origin + "/api/tutor", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{"
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).reason, "invalid-json");
});

test("oversized and structurally invalid API bodies stop before model calls", async () => {
  const oversized = await fetch(origin + "/api/speech", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "a".repeat(40_000) })
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).reason, "request-too-large");

  const missingState = await fetch(origin + "/api/tutor/quick", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ input: "你好" })
  });
  assert.equal(missingState.status, 400);
  assert.equal((await missingState.json()).reason, "invalid-state");
});
