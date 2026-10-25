import test from "node:test";
import assert from "node:assert/strict";
import { createAppStore } from "../src/app/appStore.js";
import { normalizeApplicationState } from "../src/app/applicationState.js";

test("app store normalizes a commit before notifying the view", () => {
  const input = {
    profile: { name: "焘焘" },
    family: { members: [], activeSpeakerId: "" },
    messages: [{ role: "child", text: "我们聊小狗" }],
    board: { type: "science", items: ["月亮"] }
  };
  const snapshot = structuredClone(input);
  const store = createAppStore(input, { normalize: normalizeApplicationState });
  const notifications = [];
  store.subscribe((nextState, previousState, event) => notifications.push({ nextState, previousState, event }));

  const committed = store.commit(input, { type: "test/committed" });

  assert.deepEqual(input, snapshot, "normalization must not mutate the caller state");
  assert.equal(committed.board.type, "blank");
  assert.equal(committed.family.members[0].name, "焘焘");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].event.type, "test/committed");
  assert.equal(store.getState(), committed);
});

test("subscribers can unsubscribe without changing the committed state", () => {
  const store = createAppStore({ count: 0 });
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });

  store.commit({ count: 1 });
  unsubscribe();
  store.commit({ count: 2 });

  assert.equal(calls, 1);
  assert.deepEqual(store.getState(), { count: 2 });
});
