import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadLocalEnv } from "../server/env.mjs";
import { generateOpenDrawing, imageConfig } from "../server/openDrawing.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const folder = resolve(root, "screenshots/open-drawing-live-2026-10-05");
const ledgerPath = resolve(folder, "results.json");
if (!process.argv.includes("--allow-paid-synthetic")) {
  throw new Error("Explicit --allow-paid-synthetic approval is required.");
}
loadLocalEnv(root);
const env = { ...process.env, IMAGE_DRAWING_ENABLED: "true" };
if (!imageConfig(env).enabled) throw new Error("Image account configuration is unavailable.");
await mkdir(folder, { recursive: true });
let results;
try { results = JSON.parse(await readFile(ledgerPath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; results = []; }
const cases = [
  ["create", "画一座红色屋顶、黄色墙壁的小房子，房子在绿色草地上，天空有一个太阳。"],
  ["edit", "只把房子的屋顶改成蓝色，其他地方保持不变。"],
  ["edit", "在房子右边增加一棵小树，保留蓝色屋顶、黄色墙壁、草地和太阳。"],
  ["edit", "只移除天空中的太阳，保留小树、蓝色屋顶、黄色墙壁和绿色草地。"],
  ["create", "画一辆在云朵轨道上行驶的蓝色小火车，车厢里放着三盆花，简洁的平涂手绘，纯白干净背景，不要纸张纹理。"],
  ["edit", "只把火车车身从蓝色改为红色。保留云朵轨道、三盆花和原来的构图。保持平涂手绘和纯白干净背景，不要添加纹理或噪点。"]
];
// Persist attempts before dispatch; rerunning never silently repeats a charged request.
for (let index = results.length; index < cases.length && results.length < 6; index++) {
  if (results.length && !results.at(-1).ok) break;
  const [operation, instruction] = cases[index];
  let image;
  if (operation === "edit") {
    const previous = resolve(folder, `${index}.png`);
    const jpeg = resolve(folder, `${index}-input.jpg`);
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "75", "-Z", "900", previous, "--out", jpeg], { stdio: "ignore" });
    image = "data:image/jpeg;base64," + (await readFile(jpeg)).toString("base64");
  }
  const record = { attempt: index + 1, operation, instruction, startedAt: new Date().toISOString(), status: "started" };
  results.push(record);
  await writeFile(ledgerPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ attempt: record.attempt, status: "started", operation }));
  const start = Date.now();
  const result = await generateOpenDrawing({ operation, instruction, image }, { env,
    fetchImpl: async (url, options) => {
      const response = await fetch(url, options);
      if (options?.method === "POST") {
        record.httpStatus = response.status;
        if (!response.ok) {
          const body = await response.clone().json().catch(() => ({}));
          record.providerCode = String(body.code || "unknown").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 100);
        }
      }
      return response;
    }
  });
  Object.assign(record, { status: "finished", ok: result.ok, reason: result.reason, model: imageConfig(env).model, elapsedMs: Date.now() - start });
  if (result.ok) {
    record.file = `${index + 1}.png`;
    await writeFile(resolve(folder, record.file), Buffer.from(result.image.split(",")[1], "base64"));
  }
  await writeFile(ledgerPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(record));
  if (!result.ok) break;
}
