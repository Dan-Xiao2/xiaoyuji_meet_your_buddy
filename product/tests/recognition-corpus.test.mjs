import test from "node:test";
import assert from "node:assert/strict";
import { recognitionCorpus } from "../src/features/voice/recognitionCorpus.js";

test("recogniser context always names 小宇 and adds recent conversation, newest kept, at most 500 characters", () => {
  assert.equal(recognitionCorpus([]), "小宇");
  const messages = [{ role: "child", text: "我在树林里看到了牛肝菌" }, { role: "tutor", text: "牛肝菌是一种蘑菇。" }, { role: "parent", text: "家长备注" }];
  assert.equal(recognitionCorpus(messages), "小宇\n我在树林里看到了牛肝菌\n牛肝菌是一种蘑菇。");
  const long = Array.from({ length: 10 }, (_, index) => ({ role: "child", text: `${index}`.repeat(200) }));
  const corpus = recognitionCorpus(long);
  assert.ok(corpus.length <= 503);
  assert.ok(corpus.endsWith("9".repeat(200)), "the newest words are kept");
});

test("safety-protected messages never reach the recogniser context", () => {
  const corpus = recognitionCorpus([{ role: "child", text: "我想自杀" }, { role: "child", text: "受保护", safetyProtected: true }, { role: "tutor", text: "我们去找大人。" }]);
  assert.equal(corpus.includes("自杀"), false);
  assert.equal(corpus.includes("受保护"), false);
});
