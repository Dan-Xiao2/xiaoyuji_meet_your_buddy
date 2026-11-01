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

test("published snapshots are deeply read-only without freezing caller-owned input", () => {
  const input = { profile: { name: "原昵称" }, messages: [{ text: "原话" }] };
  const store = createAppStore(input);
  input.profile.name = "外部修改";
  assert.equal(store.getState().profile.name, "原昵称");
  assert.throws(() => { store.getState().profile.name = "越权"; }, TypeError);
  assert.throws(() => { store.getState().messages.push({ text: "越权" }); }, TypeError);
});

test("commits detach caller-owned nested objects and preserve previous snapshots", () => {
  const store = createAppStore({ profile: { name: "之前" } });
  const old = store.getState(), notifications = [];
  store.subscribe((next, previous) => notifications.push({ next, previous }));
  const input = { profile: { name: "之后" } };
  store.commit(input);
  input.profile.name = "迟到修改";
  assert.equal(old.profile.name, "之前");
  assert.equal(store.getState().profile.name, "之后");
  assert.equal(notifications[0].previous, old);
  assert.throws(() => { notifications[0].next.profile.name = "订阅者修改"; }, TypeError);
});

test("updates read the latest snapshot and no-op updates do not notify", () => {
  const store = createAppStore({ count: 0, profile: { name: "原昵称" } });
  let calls = 0;
  store.subscribe(() => calls++);
  store.update(current => ({ ...current, profile: { name: "新昵称" } }));
  store.update(current => ({ ...current, count: current.count + 1 }));
  const latest = store.getState();
  assert.equal(store.update(current => current), latest);
  assert.deepEqual(latest, { count: 1, profile: { name: "新昵称" } });
  assert.equal(calls, 2);
});

test("a mutating updater fails before publication and leaves the accepted state untouched", () => {
  const store = createAppStore({ profile: { name: "保留" } });
  const previous = store.getState();
  let calls = 0;
  store.subscribe(() => calls++);
  let entered = false;
  assert.throws(() => store.update(current => { entered = true; current.profile.name = "越权"; return current; }), TypeError);
  assert.equal(entered, true, "the updater must run before rejecting its illegal mutation");
  assert.equal(store.getState(), previous);
  assert.equal(calls, 0);
});
