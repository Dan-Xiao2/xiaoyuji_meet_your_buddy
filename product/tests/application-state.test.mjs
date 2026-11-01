import test from "node:test";
import assert from "node:assert/strict";
import { createAppStore } from "../src/app/appStore.js";
import { normalizeApplicationState, updateProfileState, startSessionState, endSessionState } from "../src/app/applicationState.js";
import { createInitialState } from "../src/data/studentModel.js";
import { addFamilyMember, setActiveSpeaker, removeFamilyMember } from "../src/data/familyModel.js";
import { createConversationCommit, applyConversationCommit } from "../src/features/conversation/conversationCommit.js";

const storeFor = () => createAppStore(createInitialState(), { normalize: normalizeApplicationState });

test("profile update synchronizes the primary child and model without changing old snapshots", () => {
  const store = storeFor(), old = store.getState(), original = structuredClone(old);
  store.update(current => updateProfileState(current, { name: "新昵称", consent: true, configured: true }));
  const next = store.getState();
  assert.equal(next.profile.name, "新昵称");
  assert.equal(next.family.members.find(member => member.isPrimaryChild).name, "新昵称");
  assert.equal(next.studentModel.profile.nickname, "新昵称");
  assert.equal(next.messages.length, old.messages.length);
  assert.deepEqual(old, original);
});

test("family operations preserve the profile, active speaker fallback and earlier member lists", () => {
  const store = storeFor();
  store.update(current => updateProfileState(current, { name: "模拟孩子" }));
  const old = store.getState();
  store.update(current => ({ ...current, family: addFamilyMember(current.family, { name: "模拟家人", role: "mother" }) }));
  const member = store.getState().family.members.find(member => member.role === "mother");
  store.update(current => ({ ...current, family: setActiveSpeaker(current.family, member.id) }));
  assert.equal(store.getState().family.activeSpeakerId, member.id);
  store.update(current => ({ ...current, family: removeFamilyMember(current.family, member.id) }));
  assert.equal(store.getState().family.activeSpeakerId, old.family.activeSpeakerId);
  assert.deepEqual(store.getState().profile, old.profile);
  assert.equal(old.family.members.length, 1);
});

test("starting and ending a session keep old snapshots intact and repeated lifecycle commands are no-ops", () => {
  const store = storeFor(), idle = store.getState();
  const now = new Date("2026-10-28T10:00:00Z");
  store.update(current => startSessionState(current, { name: "模拟孩子", consent: true, configured: true }, now));
  const active = store.getState();
  assert.equal(active.session.status, "active");
  assert.equal(active.session.startedAt, now.toISOString());
  assert.equal(idle.session.status, "idle");
  assert.equal(store.update(current => startSessionState(current, { name: "不能重置" })), active);
  store.update(current => endSessionState(current, [], new Date("2026-10-28T10:03:00Z")));
  const ended = store.getState();
  assert.equal(ended.session.status, "ended");
  assert.equal(active.session.status, "active");
  assert.equal(store.update(current => endSessionState(current, [])), ended);
  assert.deepEqual(active.messages, []);
});

test("a delayed reply preserves a newly accepted profile and evidence conflicts preserve the new model", () => {
  const store = storeFor();
  store.update(current => startSessionState(current, { name: "原昵称", consent: true, configured: true }));
  store.update(current => ({ ...current, messages: [{ id: "t:child", turnId: "t", role: "child", text: "发现" }],
    llmStatus: { pending: true, stage: "quick-reply" } }));
  const before = store.getState();
  const quick = createConversationCommit(before, { ...before, messages: [...before.messages,
    { id: "t:tutor", turnId: "t", role: "tutor", text: "已接受回答" }],
    llmStatus: { pending: false, enrichmentPending: true } }, { kind: "quick", turnId: "t" });
  store.update(current => updateProfileState(current, { name: "新昵称" }));
  store.update(current => applyConversationCommit(current, quick).state);
  const accepted = store.getState();
  assert.equal(accepted.profile.name, "新昵称");
  assert.equal(accepted.messages[1].text, "已接受回答");
  const complete = createConversationCommit(accepted, { ...accepted, studentModel: { ...accepted.studentModel, profile: { nickname: "旧推断" } } }, { kind: "complete", turnId: "t" });
  store.update(current => updateProfileState(current, { name: "再次更新" }));
  const result = applyConversationCommit(store.getState(), complete);
  assert.deepEqual(result.conflicts, ["studentModel"]);
  assert.equal(result.state.studentModel.profile.nickname, "再次更新");
  store.update(current => endSessionState(current, []));
  assert.equal(applyConversationCommit(store.getState(), complete).accepted, false);
});
