import { validImageBoard } from "../whiteboard/openDrawing.js";

export async function routeDrawing(input, board, messages, signal, pendingRequest) {
  try {
    const response = await fetch("/api/whiteboard/route", { method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input,
        board: validImageBoard(board) ? { type: "image", instruction: board.instruction } : board,
        pendingRequest: typeof pendingRequest === "string" ? pendingRequest.slice(0, 1000) : undefined,
        context: messages.slice(-4).map(m => ({ role: m.role, text: m.text })) }) });
    if (!response.ok) throw new Error("route");
    const route = await response.json();
    const hasText = value => typeof value === "string" && value.trim().length > 0;
    if (!route || !["chat", "precise", "clarify", "image"].includes(route.mode) ||
      (route.mode === "clarify" && !hasText(route.reply)) ||
      (route.mode === "image" && (!hasText(route.instruction) ||
        !["create", "edit"].includes(route.operation) || typeof route.available !== "boolean"))) throw new Error("route-contract");
    return route;
  } catch { return { mode: "clarify", reply: "这次绘画请求没处理成功。内容还记着，你可以说再试一次。" }; }
}

export async function compactImage(source) {
  const image = new Image(); image.src = source; await image.decode();
  const canvas = document.createElement("canvas");
  const ratio = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.round(image.naturalWidth * ratio); canvas.height = Math.round(image.naturalHeight * ratio);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.5, 0.3]) {
    const data = canvas.toDataURL("image/jpeg", quality);
    if (data.length <= 260000) return data;
  }
  throw new Error("image-size");
}

export async function snapshotDrawing(board, container) {
  if (validImageBoard(board)) return board.image;
  const svg = container.querySelector(".illustration-scene svg");
  if (!svg) throw new Error("missing-original");
  const copy = svg.cloneNode(true);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", "640"); copy.setAttribute("height", "480");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }));
  try { return await compactImage(url); } finally { URL.revokeObjectURL(url); }
}

export async function requestImage(route, image, signal) {
  const response = await fetch("/api/whiteboard/image", { method: "POST", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: route.instruction, operation: route.operation, image }) });
  if (!response.ok) throw new Error("image-request");
  const result = await response.json();
  if (!result.ok) throw new Error(result.reason);
  if (Number.isFinite(result.latencyMs)) console.info("[小宇记耗时] 图片", result.latencyMs, "ms");
  if (typeof result.image !== "string" || !result.image.startsWith("data:image/png;base64,") || result.image.length > 11000000) throw new Error("image-result");
  return compactImage(result.image);
}
