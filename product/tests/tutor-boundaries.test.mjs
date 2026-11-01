import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../src/data/studentModel.js";
import { clearLocalStudentDb, loadLocalStudentDb } from "../src/data/localStudentDb.js";
import { createTutorTurn } from "../src/services/tutorEngine.js";
import { callQuickTutorApi, callTutorApi } from "../src/services/llmClient.js";
import { createQuickTutorReplyWithQwen, createTutorTurnWithQwen } from "../server/qwenTutor.mjs";

test("calculating lesson and answer candidates never writes a student database", () => {
  clearLocalStudentDb();
  const initial = createInitialState();
  const before = structuredClone(loadLocalStudentDb());
  const events = [];
  const onStudentEvent = (...args) => events.push(args);
  const lesson = createTutorTurn("练习减法", initial, { onStudentEvent });
  const answered = createTutorTurn(String(lesson.activeLesson.problem.answer), lesson, { onStudentEvent });
  assert.equal(answered.lastAssessment.correct, true);
  assert.deepEqual(loadLocalStudentDb(), before, "Unaccepted calculations must not persist, including in Node's shared memory database");
  assert.deepEqual(events.map(event => event[1]), ["lesson_started", "student_answered"]);
});

test("HTTP tutor context excludes parent credentials, family archive and UI state; enrichment cannot replace local model", async () => {
  const state = createInitialState();
  state.profile.parentPinHash = "private-pin-sentinel";
  state.family.privateNote = "private-family-sentinel";
  state.studentModel.workArtifacts = [{ text: "private-artifact-sentinel" }];
  state.memory.mastery = { retained: 0.4 };
  state.messages = Array.from({ length: 20 }, (_, i) => ({ role: "child", text: `第${i}个发现`, internal: "private-message-sentinel" }));
  state.activeSpeaker = { name: "家人", role: "mother", voiceEnrollment: "private-voice-sentinel" };
  state.board = { type: "image", image: { dataUrl: "private-image-sentinel" } };
  const envWindow = globalThis.window, fetch = globalThis.fetch;
  globalThis.window = { location: { protocol: "http:" }, performance };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json(url.endsWith("/quick") ? { reply: "我们一起看看。" } : {
      memory: { interests: ["花"], recentWins: [] }, growthEvidence: { shouldSave: false },
      studentModel: { studentId: "wrong-child" }, profile: { name: "overwrite" }, llmStatus: { used: true }
    });
  };
  try {
    await callQuickTutorApi({ input: "这是什么", state, fallbackReply: "我听到了。" });
    const result = await callTutorApi({ input: "这是什么", state, spokenReply: "我们一起看看。" });
    assert.doesNotMatch(JSON.stringify(requests), /private-/);
    for (const request of requests) {
      assert.equal(request.state.messages.length, 12);
      assert.equal(request.state.activeSpeaker.role, "mother");
      assert.equal(request.state.messages.at(-1).text, "第19个发现");
      assert.equal(request.state.studentModel, undefined);
    }
    assert.equal(result.studentModel, undefined);
    assert.equal(result.profile, undefined);
    assert.deepEqual(result.memory.mastery, state.memory.mastery);
    assert.deepEqual(result.memory.interests, ["花"]);
  } finally { globalThis.window = envWindow; globalThis.fetch = fetch; }
});

for (const stage of ["quick", "full"]) {
  for (const timing of ["before", "during"]) test(`${stage} cancellation ${timing} a model request rejects instead of producing fallback`, async () => {
    const env = { ...process.env }, fetch = globalThis.fetch;
    Object.assign(process.env, { TUTOR_ENABLE_LLM: "true", LLM_PROVIDER: "qwen", QWEN_API_KEY: "synthetic-only" });
    const abort = new AbortController();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      abort.abort();
      // Even an adapter that returns after abort must not publish the stale response.
      return Response.json({ choices: [{ message: { content: stage === "quick" ? "我们一起看看。" : JSON.stringify({ tutorReply: "我们一起看看。", board: { type: "blank" } }) } }] });
    };
    if (timing === "before") abort.abort();
    try {
      const state = createInitialState();
      const request = stage === "quick"
        ? createQuickTutorReplyWithQwen("我看到一朵花", state, "本地回答", { signal: abort.signal })
        : createTutorTurnWithQwen("我看到一朵花", state, { signal: abort.signal });
      await assert.rejects(request, { name: "AbortError" });
      assert.equal(calls, timing === "before" ? 0 : 1);
    } finally { process.env = env; globalThis.fetch = fetch; }
  });
}

test("ordinary provider failure still returns a local quick fallback", async () => {
  const env = { ...process.env }, fetch = globalThis.fetch;
  Object.assign(process.env, { TUTOR_ENABLE_LLM: "true", LLM_PROVIDER: "qwen", QWEN_API_KEY: "synthetic-only" });
  globalThis.fetch = async () => { throw new Error("synthetic outage"); };
  try {
    const reply = await createQuickTutorReplyWithQwen("我看到一朵花", createInitialState(), "我们一起看看。");
    assert.equal(reply.reply, "我们一起看看。");
    assert.equal(reply.llmStatus.fallback, true);
  } finally { process.env = env; globalThis.fetch = fetch; }
});
