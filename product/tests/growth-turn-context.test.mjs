import test from "node:test";
import assert from "node:assert/strict";
import { captureGrowthTurnContext } from "../src/features/growth/growthTurnContext.js";
import { createInitialState } from "../src/data/studentModel.js";
import { createConversationTurn } from "../src/services/tutorEngine.js";

test("ordinary chat does not inherit a retained drawing or its title/topics", () => {
  for (const input of ["画一个房子", "我有五块积木，给爸爸两块"]) {
    const drawing = createConversationTurn(input, createInitialState());
    const chat = createConversationTurn("那恐龙呢", drawing);
    assert.deepEqual(chat.board, drawing.board, "The displayed picture remains available");
    const context = captureGrowthTurnContext(chat, chat);
    assert.deepEqual(context, { eligible: true, domain: "language", lessonTitle: "", boardSnapshot: null, topics: [] });
  }
});

test("accepted drawing and block modifications capture that turn's exact version", () => {
  for (const [input, followup, domain] of [["画一个房子", "再加一个太阳", "art"],
    ["我有五块积木，给爸爸两块", "再给爸爸一块", "math"]]) {
    const first = createConversationTurn(input, createInitialState());
    const next = createConversationTurn(followup, first);
    const context = captureGrowthTurnContext(next, next);
    assert.equal(context.domain, domain);
    assert.deepEqual(context.boardSnapshot, next.board);
    assert.notEqual(context.boardSnapshot, next.board);
    const revision = context.boardSnapshot.scene.revision;
    next.board.scene.revision++;
    assert.equal(context.boardSnapshot.scene.revision, revision, "Later changes cannot rewrite the evidence context");
  }
});

test("rejected visual publication cannot attach the proposed or retained board", () => {
  const candidate = createConversationTurn("画一个房子", createInitialState());
  const accepted = { ...candidate, board: { type: "blank" } };
  const context = captureGrowthTurnContext(candidate, accepted);
  assert.equal(context.boardSnapshot, null);
  assert.equal(context.domain, "language");
  assert.equal(context.lessonTitle, "");
});

test("clarifications, waiting and unchanged drawing replies remain ineligible", () => {
  const original = createConversationTurn("画一个房子", createInitialState());
  for (const plan of [{ needsPlanner: true }, { changed: false }]) {
    const turn = { ...original, visualPlan: { ...plan, board: original.board } };
    const context = captureGrowthTurnContext(turn, turn);
    assert.equal(context.eligible, false);
    assert.equal(context.boardSnapshot, null);
  }
});

test("explicit lesson context remains available, but parent observations cannot inherit it", () => {
  const turn = { activeLesson: { activity: "story", title: "A story", story: { title: "A story" } },
    board: { type: "story", title: "A story", items: ["tree"] } };
  const context = captureGrowthTurnContext(turn, turn);
  assert.equal(context.domain, "story");
  assert.equal(context.lessonTitle, "A story");
  assert.deepEqual(context.topics, ["tree", "A story"]);
  const parentTurn = { ...turn, activeSpeaker: { role: "parent" } };
  assert.equal(captureGrowthTurnContext(parentTurn, parentTurn).boardSnapshot, null);
  assert.equal(captureGrowthTurnContext(turn, { ...turn, activeLesson: null }).boardSnapshot, null);
});

test("raster images are never duplicated into growth context", () => {
  const board = { type: "image", id: "image-1", revision: 1, image: "data:image/jpeg;base64,AAAA", title: "A picture" };
  const turn = { board, visualPlan: { changed: true, board } };
  assert.equal(captureGrowthTurnContext(turn, turn).boardSnapshot, null);
});
