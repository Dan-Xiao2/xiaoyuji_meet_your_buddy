import test from "node:test";
import assert from "node:assert/strict";
import { routeDrawing } from "../src/services/openDrawingClient.js";

test("drawing route rejects malformed successful responses instead of entering the planner", async t => {
  for (const value of [null, {}, [], { mode: "unknown" }, { mode: "clarify" },
    { mode: "clarify", reply: " " }, { mode: "image", operation: "create", instruction: "a dinosaur" },
    { mode: "image", operation: "remove", instruction: "a dinosaur", available: true },
    { mode: "image", operation: "create", instruction: " ", available: true }]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(value));
    const result = await routeDrawing("draw", { type: "blank" }, [], new AbortController().signal);
    assert.equal(result.mode, "clarify", JSON.stringify(value));
    assert.match(result.reply, /没处理成功/, JSON.stringify(value));
    t.mock.restoreAll();
  }
});

test("drawing route preserves the four supported response contracts", async t => {
  for (const value of [{ mode: "chat" }, { mode: "precise" }, { mode: "clarify", reply: "Which part?" },
    { mode: "image", operation: "create", instruction: "a dinosaur", available: false },
    { mode: "image", operation: "edit", instruction: "blue roof", available: true }]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(value));
    assert.deepEqual(await routeDrawing("draw", { type: "blank" }, [], new AbortController().signal), value);
    t.mock.restoreAll();
  }
});
