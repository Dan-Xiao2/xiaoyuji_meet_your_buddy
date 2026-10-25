import { drawingCatalog, drawableKinds, isGroundObject } from "./drawingCatalog.js";
// The renderer and model planner share this bounded, data-only protocol.
export const drawingKinds = Object.fromEntries(Object.entries(drawingCatalog).map(([kind, entry]) => [kind, entry.label]));
export const drawingColors = { 红色: "#df837a", 蓝色: "#87bbc9", 黄色: "#efc76e", 绿色: "#93b69b", 紫色: "#b5a0bf", 白色: "#ffffff" };
const palette = Object.values(drawingColors);
const groundSlots = [126, 320, 514];
const skySlots = [110, 320, 530];
const clone = value => JSON.parse(JSON.stringify(value));
const identifier = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const ground = isGroundObject;
const defaults = Object.fromEntries(Object.entries(drawingCatalog).map(([kind, entry]) => [kind, entry.color]));
export const houseDetailDefaults = { doorShape: "arched", doorColor: "#93b69b", windowCount: 2,
  windowShape: "square", windowColor: "#d7eaf0" };
const houseKeys = Object.keys(houseDetailDefaults);

function validHouseDetails(o) {
  if (o.kind !== "house") return houseKeys.every(key => !(key in o));
  return (!("doorShape" in o) || ["arched", "rect"].includes(o.doorShape)) &&
    (!("windowShape" in o) || ["square", "round"].includes(o.windowShape)) &&
    (!("windowCount" in o) || (Number.isInteger(o.windowCount) && o.windowCount >= 0 && o.windowCount <= 4)) &&
    (!("doorColor" in o) || palette.includes(o.doorColor)) &&
    (!("windowColor" in o) || [...palette, houseDetailDefaults.windowColor].includes(o.windowColor));
}

function validObjects(objects) {
  if (!Array.isArray(objects) || objects.length > 8) return false;
  const ids = new Set(objects.map(o => o?.id));
  if (ids.size !== objects.length) return false;
  for (const o of objects) {
    if (!o || !identifier(o.id) || !Object.hasOwn(drawingKinds, o.kind) || !palette.includes(o.color) ||
        !palette.includes(o.roofColor) || !Number.isFinite(o.scale) || o.scale < 0.65 || o.scale > 1.2 ||
        !Number.isFinite(o.x) || !Number.isFinite(o.y)) return false;
    if (!validHouseDetails(o) || Object.keys(o).some(key => !["id", "kind", "x", "y", "scale", "color", "roofColor", "from", "to", ...houseKeys].includes(key))) return false;
    if (o.kind === "path") {
      if (o.from === o.to || ![o.from, o.to].every(id => objects.some(n => n.id === id && n.kind === "house"))) return false;
    } else {
      if ("from" in o || "to" in o) return false;
      const slots = ground(o) ? groundSlots : skySlots;
      if (!slots.includes(o.x) || o.y !== (ground(o) ? 366 : 108)) return false;
    }
  }
  const placed = objects.filter(o => o.kind !== "path");
  return new Set(placed.map(o => `${o.x}:${o.y}`)).size === placed.length;
}

export function validDrawingScene(s) {
  return s?.kind === "illustration" && s.version === 2 && identifier(s.id) &&
    Number.isSafeInteger(s.revision) && s.revision > 0 && Number.isSafeInteger(s.nextId) && s.nextId > 0 &&
    validObjects(s.objects) && Array.isArray(s.history) && s.history.length <= 12 && s.history.every(validObjects) &&
    Array.isArray(s.steps) && s.steps.length >= 1 && s.steps.length <= 8 &&
    s.steps.every(step => typeof step?.text === "string" && step.text.length <= 120) &&
    (s.presentation === undefined ? s.steps.length === 1 : (s.presentation &&
      Object.keys(s.presentation).every(k => ["initialObjects", "frames"].includes(k)) &&
      validObjects(s.presentation.initialObjects) && Array.isArray(s.presentation.frames) &&
      s.presentation.frames.length === s.steps.length && s.presentation.frames.every(validObjects) &&
      JSON.stringify(s.presentation.frames.at(-1)) === JSON.stringify(s.objects))) &&
    Array.isArray(s.changedIds) && s.changedIds.length <= 16 && s.changedIds.every(identifier);
}

export function validLegacyDrawing(s) {
  return s?.kind === "illustration" && s.version === undefined && identifier(s.id) &&
    Number.isSafeInteger(s.revision) && s.revision > 0 && Array.isArray(s.subjects) && s.subjects.length > 0 &&
    s.subjects.length <= 4 && new Set(s.subjects).size === s.subjects.length &&
    s.subjects.every(k => ["house", "sun", "tree", "cloud"].includes(k)) && palette.includes(s.roofColor) &&
    Array.isArray(s.steps) && s.steps.length === 1 && typeof s.steps[0]?.text === "string" && s.steps[0].text.length <= 120;
}

function compatibility(s) {
  s.subjects = [...new Set(s.objects.map(o => o.kind))];
  s.roofColor = s.objects.find(o => o.kind === "house")?.roofColor || drawingColors.红色;
  return s;
}

export function createDrawingScene(id) {
  return compatibility({ kind: "illustration", version: 2, id, revision: 1, nextId: 1,
    objects: [], history: [], changedIds: [], steps: [{ text: "" }] });
}

export function normalizeDrawingScene(scene) {
  if (validDrawingScene(scene)) {
    const { kind, version, id, revision, nextId, objects, history, changedIds, steps, presentation } = scene;
    return compatibility(clone({ kind, version, id, revision, nextId, objects, history, changedIds,
      steps: steps.map(step => ({ text: step.text })), ...(presentation ? { presentation } : {}) }));
  }
  if (!validLegacyDrawing(scene)) return null;
  const initial = createDrawingScene(scene.id);
  const migrated = applyDrawingOperations(initial, { baseRevision: initial.revision,
    operations: scene.subjects.map(kind => ({ op: "add", kind, count: 1 })) });
  const s = migrated.scene;
  s.objects.filter(o => o.kind === "house").forEach(o => { o.roofColor = scene.roofColor; });
  s.revision = scene.revision; s.history = []; s.changedIds = []; s.steps = clone(scene.steps);
  return compatibility(s);
}

// Atomic: malformed, stale or partly unsupported plans leave the entire scene untouched.
export function applyDrawingOperations(source, plan) {
  const fail = reason => ({ ok: false, reason, scene: source });
  if (!validDrawingScene(source) || plan?.baseRevision !== source.revision) return fail("stale");
  if (!Array.isArray(plan.operations) || !plan.operations.length || plan.operations.length > 8) return fail("invalid");
  const s = normalizeDrawingScene(source), before = clone(s.objects);
  // Playback belongs to one turn only; never carry old frames into a new mutation.
  delete s.presentation;
  s.steps = [{ text: "" }];
  let undo = false;
  for (const action of plan.operations) {
    if (!action || typeof action !== "object") return fail("invalid");
    const allowed = { add: ["op", "kind", "count"], update: ["op", "id", "patch"], remove: ["op", "id"],
      move: ["op", "id", "direction"], connect: ["op", "from", "to"], undo: ["op"], clear: ["op"],
      duplicate: ["op", "id"], place: ["op", "id", "relativeTo", "side"] }[action.op];
    if (!allowed || Object.keys(action).some(k => !allowed.includes(k))) return fail("invalid");
    const object = s.objects.find(o => o.id === action.id);
    if (action.op === "add") {
      if (!drawableKinds.includes(action.kind) || !Number.isInteger(action.count) || action.count < 1 || action.count > 3) return fail("invalid");
      const isGround = ground({ kind: action.kind });
      const slots = isGround ? groundSlots : skySlots;
      let available = slots.filter(x => !s.objects.some(o => ground(o) === isGround && o.kind !== "path" && o.x === x));
      if (available.length < action.count) return fail("capacity");
      if (available.length === 3 && isGround) available = action.count === 2 ? [126, 514, 320] : action.count === 1 ? [320, 126, 514] : available;
      for (let i = 0; i < action.count; i++) {
        let id;
        do { id = `object-${s.nextId++}`; } while (s.objects.some(o => o.id === id));
        s.objects.push({ id, kind: action.kind, x: available[i], y: isGround ? 366 : 108,
          scale: 1, color: defaults[action.kind], roofColor: drawingColors.红色 });
      }
    } else if (action.op === "duplicate") {
      if (!object || object.kind === "path") return fail("invalid");
      const slots = ground(object) ? groundSlots : skySlots;
      const available = slots.filter(x => !s.objects.some(o => o.kind !== "path" && o.y === object.y && o.x === x));
      if (!available.length) return fail("capacity");
      available.sort((a, b) => Math.abs(a - object.x) - Math.abs(b - object.x));
      let id;
      do { id = `object-${s.nextId++}`; } while (s.objects.some(o => o.id === id));
      s.objects.push({ ...object, id, x: available[0] });
    } else if (action.op === "place") {
      const anchor = s.objects.find(o => o.id === action.relativeTo);
      if (!object || !anchor || object.id === anchor.id || object.kind === "path" || anchor.kind === "path" ||
          object.y !== anchor.y || !["left", "right"].includes(action.side)) return fail("invalid");
      const slots = ground(object) ? groundSlots : skySlots;
      const index = slots.indexOf(anchor.x) + (action.side === "left" ? -1 : 1);
      const x = slots[index];
      if (x === undefined) return fail("capacity");
      const other = s.objects.find(o => o.id !== object.id && o.kind !== "path" && o.x === x && o.y === object.y);
      if (other) return fail("capacity");
      object.x = x;
    } else if (action.op === "update") {
      if (!object || !action.patch || typeof action.patch !== "object" || !Object.keys(action.patch).length ||
          Object.keys(action.patch).some(k => !["color", "roofColor", "scale", ...houseKeys].includes(k)) ||
          ("roofColor" in action.patch && object.kind !== "house") || object.kind === "path") return fail("invalid");
      Object.assign(object, action.patch);
    } else if (action.op === "move") {
      if (!object || object.kind === "path" || !["left", "right", "center"].includes(action.direction)) return fail("invalid");
      const slots = ground(object) ? groundSlots : skySlots;
      const x = action.direction === "left" ? slots[0] : action.direction === "right" ? slots.at(-1) : slots[1];
      const other = s.objects.find(o => o.id !== object.id && o.kind !== "path" && o.x === x && o.y === object.y);
      if (other) other.x = object.x;
      object.x = x;
    } else if (action.op === "remove") {
      if (!object) return fail("missing");
      s.objects = s.objects.filter(o => o.id !== action.id && o.from !== action.id && o.to !== action.id);
    } else if (action.op === "connect") {
      if (s.objects.some(o => o.kind === "path" && [o.from, o.to].includes(action.from) && [o.from, o.to].includes(action.to))) return fail("unchanged");
      s.objects.push({ id: `object-${s.nextId++}`, kind: "path", from: action.from, to: action.to,
        x: 0, y: 0, scale: 1, color: drawingColors.黄色, roofColor: drawingColors.红色 });
    } else if (action.op === "clear") {
      s.objects = [];
    } else if (action.op === "undo") {
      if (plan.operations.length !== 1 || !s.history.length) return fail("history");
      s.objects = s.history.pop(); undo = true;
    }
  }
  if (!validObjects(s.objects)) return fail("invalid");
  if (JSON.stringify(before) === JSON.stringify(s.objects)) return fail("unchanged");
  if (!undo) s.history = [...s.history, before].slice(-12);
  s.changedIds = [...new Set([...before, ...s.objects].map(o => o.id))].filter(id =>
    JSON.stringify(before.find(o => o.id === id)) !== JSON.stringify(s.objects.find(o => o.id === id)));
  s.revision++;
  if (!validDrawingScene(s)) return fail("invalid");
  return { ok: true, scene: compatibility(s) };
}
