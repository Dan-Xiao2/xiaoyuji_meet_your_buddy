import test from "node:test";
import assert from "node:assert/strict";
import { imageConfig, validRaster, routeOpenDrawing, generateOpenDrawing, reviewGeneratedImage } from "../server/openDrawing.mjs";
import { imageBoard, validImageBoard, undoImageBoard, createDrawingJob } from "../src/whiteboard/openDrawing.js";
import { resolveIllustrationPlan } from "../src/whiteboard/illustrationPlan.js";
import { relevantBoard } from "../src/whiteboard/visualPlan.js";

const env = { QWEN_API_KEY: "test-key", IMAGE_DRAWING_ENABLED: "true" };
const jpeg = "data:image/jpeg;base64,/9j/AA==";
const png = "data:image/png;base64,iVBORw0KGgo=";
const output = value => ({ ok: true, json: async () => value });
const approvedReview = () => output({ choices: [{ message: { content: JSON.stringify({
  safeForYoungChild: true, matchesInstruction: true, preservesUnrequestedContent: true, reason: ""
}) } }] });

test("image calls opt in, share region but never accept arbitrary upstream hosts", () => {
  assert.equal(imageConfig({ QWEN_API_KEY: "test" }).enabled, false);
  assert.equal(imageConfig(env).enabled, true);
  assert.equal(imageConfig({ ...env, QWEN_BASE_URL: "http://localhost/" }).enabled, false);
  assert.equal(imageConfig({ ...env, QWEN_BASE_URL: "https://attacker.test/" }).enabled, false);
  assert.match(imageConfig({ ...env, QWEN_BASE_URL: "https://demo.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" }).url, /demo.ap-southeast-1/);
});

test("unknown drawing subjects are routed instead of silently losing grass", () => {
  assert.equal(resolveIllustrationPlan("画一个穿雨靴的小朋友").needsPlanner, true);
  assert.equal(resolveIllustrationPlan("画红色太阳和草地上的房子").needsPlanner, true);
  assert.equal(resolveIllustrationPlan("画房子").changed, true);
});

test("router passes bounded textual context, no image bytes or family profile", async () => {
  const result = await routeOpenDrawing({ input: "加上草地", board: { type: "image", image: jpeg, instruction: "房子" },
    context: Array(10).fill({ role: "child", text: "房子" }) }, { env, fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body), data = JSON.parse(body.messages[1].content);
      assert.equal(data.board.image, undefined); assert.equal(data.context.length, 4);
      return output({ choices: [{ message: { content: JSON.stringify({ mode: "image", operation: "edit", instruction: "在原图房子下面加绿草地，其他不变" }) } }] });
    } });
  assert.equal(result.mode, "image"); assert.equal(result.operation, "edit");
});

test("router errors and unsafe inputs cannot launch image generation", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("provider"); };
  assert.equal((await routeOpenDrawing({ input: "画裸体" }, { env, fetchImpl })).mode, "clarify");
  assert.equal(calls, 0);
  assert.equal((await routeOpenDrawing({ input: "画草地" }, { env, fetchImpl })).mode, "clarify");
});

test("image edits preserve the latest instruction even if the router repeats an old addition", async () => {
  const input = "去掉红色气球，只保留斑马，其他地方不变。";
  const result = await routeOpenDrawing({ input, board: { type: "image", instruction: "增加红色气球" } }, {
    env, fetchImpl: async () => output({ choices: [{ message: { content: JSON.stringify({ mode: "image", operation: "edit", instruction: "增加红色气球" }) } }] })
  });
  assert.equal(result.instruction, input);
});

test("image inputs accept raster only, reject URL, SVG, oversized and mismatched bytes", () => {
  assert.ok(validRaster(jpeg)); assert.ok(validRaster(png));
  for (const data of ["https://private.test/image", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,AAAA", jpeg.repeat(100000)]) assert.equal(validRaster(data), false);
});

test("editing sends the actual previous picture; creation does not send it", async () => {
  for (const operation of ["create", "edit"]) {
    let requests = 0;
    const result = await generateOpenDrawing({ instruction: "屋顶改蓝色", image: jpeg, operation }, { env, fetchImpl: async (url, options) => {
      requests++;
      if (requests === 1) {
        const body = JSON.parse(options.body);
        assert.equal(body.input.messages[0].content.filter(c => c.image).length, operation === "edit" ? 1 : 0);
        assert.equal(body.parameters.prompt_extend, false);
        return output({ output: { choices: [{ message: { content: [{ image: "https://test.oss-cn-beijing.aliyuncs.com/generated.png" }] } }] } });
      }
      if (requests === 2) {
        assert.equal(options.headers, undefined, "Do not send API keys to asset hosts");
        assert.equal(options.redirect, "error");
        return new Response(Buffer.from(png.split(",")[1], "base64"));
      }
      const body = JSON.parse(options.body);
      assert.equal(body.model, "qwen3-vl-flash");
      assert.equal(body.messages[0].content.filter(c => c.type === "image_url").length, operation === "edit" ? 2 : 1);
      return approvedReview();
    } });
    assert.equal(result.ok, true);
    assert.equal(result.reviewModel, "qwen3-vl-flash");
  }
});

test("generated pictures fail closed unless safety, request match and edit preservation all pass", async () => {
  for (const [review, reason] of [
    [{ safeForYoungChild: false, matchesInstruction: true, preservesUnrequestedContent: true }, "unsafe-output"],
    [{ safeForYoungChild: true, matchesInstruction: false, preservesUnrequestedContent: true }, "request-mismatch"],
    [{ safeForYoungChild: true, matchesInstruction: true, preservesUnrequestedContent: false }, "edit-mismatch"]
  ]) {
    const result = await reviewGeneratedImage({ instruction: "屋顶改蓝色", operation: "edit", sourceImage: jpeg, generatedImage: png }, {
      env, fetchImpl: async () => output({ choices: [{ message: { content: JSON.stringify(review) } }] })
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
  const unavailable = await reviewGeneratedImage({ instruction: "画草地", operation: "create", generatedImage: png }, {
    env, fetchImpl: async () => ({ ok: false })
  });
  assert.deepEqual(unavailable, { ok: false, reason: "review-failed" });
});

test("disabled, unsafe, failed and untrusted results preserve failure semantics", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return output({ output: { choices: [{ message: { content: [{ image: "https://127.0.0.1/private" }] } }] } }); };
  assert.equal((await generateOpenDrawing({ instruction: "画草地", operation: "create" }, { env: {}, fetchImpl })).reason, "not-configured");
  assert.equal((await generateOpenDrawing({ instruction: "画裸体", operation: "create" }, { env, fetchImpl })).reason, "invalid-input");
  assert.equal(calls, 0);
  assert.equal((await generateOpenDrawing({ instruction: "画草地", operation: "create" }, { env, fetchImpl })).reason, "invalid-result");
  assert.equal(calls, 1);
});

test("picture revisions have bounded local history and can undo across precise/image boundary", () => {
  const precise = resolveIllustrationPlan("画房子").board;
  let board = imageBoard(jpeg, precise, "加草地");
  assert.deepEqual(undoImageBoard(board), precise);
  assert.strictEqual(relevantBoard(board, "你好"), board);
  for (let i = 0; i < 6; i++) board = imageBoard(jpeg, board, "改蓝色");
  assert.equal(board.history.length, 3);
  assert.ok(board.history.every(b => !b.history));
  assert.ok(validImageBoard(board));
  assert.equal(validImageBoard({ ...board, image: "javascript:alert(1)" }), false);
});

test("cancelled and superseded image jobs never publish; errors do not overwrite old picture", async () => {
  const job = createDrawingJob(), published = []; let resolve;
  const first = job.run(() => new Promise(r => { resolve = r; }), value => published.push(value), () => assert.fail());
  await job.run(async () => "new", value => published.push(value), () => assert.fail());
  resolve("old"); await first;
  assert.deepEqual(published, ["new"]);
  const pending = job.run(() => new Promise(r => { resolve = r; }), () => assert.fail(), () => assert.fail());
  job.cancel(); resolve("cancelled"); await pending;
  let failed = false;
  await job.run(async () => { throw new Error("timeout"); }, () => assert.fail(), () => { failed = true; });
  assert.equal(failed, true);
});
