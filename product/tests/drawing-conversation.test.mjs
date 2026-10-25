import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { createTutorTurn } from "../src/services/tutorEngine.js";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";
import { normalizeGrowthEvidence } from "../server/qwenTutor.mjs";
import { drawingRequestInput } from "../src/whiteboard/openDrawing.js";
import { routeOpenDrawing } from "../server/openDrawing.mjs";
import { renderAdultSummary, renderParentTimeline } from "../src/ui/summary.js";
import { createSessionSummary } from "../src/session/sessionManager.js";
import { normalizeLocalStudentDb } from "../src/data/localStudentDb.js";

test("explicit imaginative drawing requests reach the planner from a blank board", () => {
  for (const input of ["我想画一个仙人掌在沙漠里面。", "我想把仙人掌画在沙漠里面。", "画一只猫", "画一个城堡"])
    assert.equal(resolveIllustrationPlan(input, createInitialState())?.needsPlanner, true, input);
  assert.equal(resolveIllustrationPlan("我喜欢画仙人掌", createInitialState()), null);
});

test("retry retains only the unfinished request from this session", () => {
  const state = { session: { id: "current" }, drawingRequest: { sessionId: "current", input: "画沙漠里的仙人掌" } };
  assert.equal(drawingRequestInput("不用了，你直接画吧。", state), "画沙漠里的仙人掌");
  assert.equal(drawingRequestInput("再试一次", state), "画沙漠里的仙人掌");
  assert.equal(drawingRequestInput("画一辆火车", state), "画一辆火车");
  assert.equal(drawingRequestInput("直接画吧", { ...state, session: { id: "new" } }), null);
  assert.equal(drawingRequestInput("不用画了", state), "不用画了");
});

test("hearing checks and greetings do not restart an old drawing conversation", () => {
  const initial = createInitialState();
  const previous = createTutorTurn("画一个房子", initial);
  for (const input of ["哈喽，小宇。", "哈喽，小雨，可以听到我说话吗？"]) {
    const turn = createTutorTurn(input, previous);
    assert.equal(turn.board, previous.board);
    assert.equal(turn.visualPlan.changed, false);
    assert.doesNotMatch(turn.messages.at(-1).text, /太阳|房子|颜色|画/);
    assert.equal(turn.growthEvidence.shouldSave, false);
  }
});

test("model enthusiasm cannot turn UI controls into growth evidence", () => {
  for (const input of ["不用了，你直接画吧。", "再试一次", "你听得到吗？", "我没有看到画", "好的。", "你好"]) {
    const evidence = normalizeGrowthEvidence({ shouldSave: true, topics: ["决策"], observation: "主动放弃选择权", inference: "具有决策能力", confidence: 1 }, input);
    assert.equal(evidence.shouldSave, false, input);
    assert.equal(evidence.observation, "");
    assert.deepEqual(evidence.topics, []);
  }
  assert.equal(normalizeGrowthEvidence({ shouldSave: true }, "我想画一棵会飞的树，因为它要去看云朵").shouldSave, true);
});

test("unfinished subject is available to the router but unsafe or oversized context is omitted", async () => {
  for (const pendingRequest of ["画仙人掌", "x".repeat(1001)]) {
    await routeOpenDrawing({ input: "想把它画在沙漠里面", pendingRequest }, {
      env: { QWEN_API_KEY: "mock" }, fetchImpl: async (_, options) => {
        const request = JSON.parse(options.body);
        const data = JSON.parse(request.messages.at(-1).content);
        assert.equal(data.pendingRequest, pendingRequest.length > 1000 ? undefined : pendingRequest);
        return Response.json({ choices: [{ message: { content: JSON.stringify({ mode: "image", operation: "create", instruction: "画沙漠里的仙人掌" }) } }] });
      }
    });
  }
});

test("adult recap does not celebrate retry text or a cached inference about it", () => {
  const state = createInitialState();
  state.messages = [{ role: "child", text: "不用了，你直接画吧。" }];
  state.activeLesson = { title: "和小宇聊了一会儿" };
  state.memory.recentWins = ["主动放弃选择权并指示对方行动"];
  const container = { innerHTML: "" };
  renderParentTimeline(container, state, [{ childQuote: state.messages[0].text, createdAt: new Date().toISOString() }]);
  assert.doesNotMatch(container.innerHTML, /放弃选择权|直接画/);
  state.activeLesson = null;
  renderAdultSummary(container, state);
  assert.equal(container.innerHTML, "");
  assert.equal(createSessionSummary([{ childQuote: state.messages[0].text, reviewEligible: true }]).standoutQuote, "");
});

test("legacy controls remain in the archive but are excluded from growth reviews", () => {
  const db = normalizeLocalStudentDb({ growthMoments: [
    { id: "retry", childQuote: "不用了，你直接画吧。", reviewEligible: true },
    { id: "idea", childQuote: "我想画一棵会飞的树", reviewEligible: true },
    { id: "parent", childQuote: "再试一次", sourceType: "parent_note", reviewEligible: true }
  ] });
  assert.equal(db.growthMoments.length, 3);
  assert.equal(db.growthMoments[0].reviewEligible, false);
  assert.equal(db.growthMoments[0].childQuote, "不用了，你直接画吧。");
  assert.equal(db.growthMoments[1].reviewEligible, true);
  assert.equal(db.growthMoments[2].reviewEligible, true);
});
