import { normalizeDrawingScene, houseDetailDefaults } from "../whiteboard/drawingScene.js";
import { compiledAssets } from "../whiteboard/compiledAssets.js";
import { drawingCatalog } from "../whiteboard/drawingCatalog.js";
const NS = "http://www.w3.org/2000/svg";
const ink = "#315d58";
const element = (tag, attributes = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

// Curated local paths. The scene can only select objects and attributes, never execute SVG/code.
const shapes = {
  house: [
    ["body", "M-65 -112 L65 -112 L65 0 L-65 0 Z"],
    ["roof", "M-78 -110 L0 -180 L78 -110 Z"],
    ["door", "M-17 0 L-17 -52 Q0 -68 17 -52 L17 0 Z"],
    ["window", "M-48 -85 L-27 -85 L-27 -59 L-48 -59 Z M27 -85 L48 -85 L48 -59 L27 -59 Z"],
    ["ink", "M-38 -85 L-38 -59 M-48 -72 L-27 -72 M38 -85 L38 -59 M27 -72 L48 -72"]
  ],
  sun: [
    ["body", "M-29 0 C-29 -39 29 -39 29 0 C29 39 -29 39 -29 0 Z"],
    ["ink", "M0 -41 L0 -52 M0 41 L0 52 M-41 0 L-52 0 M41 0 L52 0 M-30 -30 L-38 -38 M30 30 L38 38 M-30 30 L-38 38 M30 -30 L38 -38"]
  ],
  tree: [
    ["trunk", "M-10 -82 L10 -82 L14 0 L-14 0 Z"],
    ["body", "M-45 -76 C-78 -100 -54 -129 -33 -127 C-45 -168 3 -180 19 -151 C54 -166 81 -115 52 -99 C72 -61 26 -43 4 -69 C-15 -48 -57 -49 -45 -76 Z"]
  ],
  cloud: [["body", "M-51 16 C-74 -6 -48 -32 -26 -20 C-21 -48 20 -43 29 -20 C61 -31 79 6 50 21 L-51 21 Z"]]
};

function objectShapes(object) {
  const asset = compiledAssets[drawingCatalog[object.kind]?.asset];
  if (asset) return asset.map((path, index) => [`asset-${index}`, path.d]);
  if (object.kind !== "house") return shapes[object.kind] || [];
  const details = { ...houseDetailDefaults, ...object };
  const parts = shapes.house.slice(0, 2);
  parts.push(["door", details.doorShape === "rect" ? "M-17 0 L-17 -60 L17 -60 L17 0 Z" : shapes.house[2][1]]);
  // Two columns leave the doorway clear; four windows fit without shrinking the house.
  const positions = details.windowCount === 1 ? [[-38, -74]] : [[-38, -74], [38, -74], [-38, -30], [38, -30]];
  positions.slice(0, details.windowCount).forEach(([x, y], index) => {
    const d = details.windowShape === "round"
      ? `M${x - 11} ${y} a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0 Z`
      : `M${x - 11} ${y - 12} h22 v24 h-22 Z`;
    parts.push([`window-${index}`, d], [`ink-${index}`, `M${x - 10} ${y} h20 M${x} ${y - 10} v20`]);
  });
  return parts;
}

function fill(part, object) {
  if (part.startsWith("asset-")) {
    const entry = drawingCatalog[object.kind], index = Number(part.slice(6));
    return entry.tintPaths.includes(index) ? object.color : compiledAssets[entry.asset][index].fill;
  }
  if (part.startsWith("window")) return object.windowColor || houseDetailDefaults.windowColor;
  if (part.startsWith("ink")) return "none";
  return { body: object.color, roof: object.roofColor, door: object.doorColor || houseDetailDefaults.doorColor, trunk: "#c6a482" }[part];
}
const transform = o => "translate(" + o.x + "px, " + o.y + "px) scale(" + o.scale + ")";

export function createIllustrationScene(container, scene) {
  let current = normalizeDrawingScene(scene);
  let visible = current;
  let animations = [], changes = [];
  let motionFrame = 0;
  const svg = element("svg", { viewBox: "0 0 640 480", role: "img", "aria-label": "小宇的简笔画" });
  const nodes = new Map();
  const rough = window.rough?.svg(svg);
  container.replaceChildren(svg);
  function cancelMotion() {
    animations.forEach(a => a.cancel()); animations = [];
    cancelAnimationFrame(motionFrame); motionFrame = 0;
  }
  function geometry(objects) {
    for (const object of objects) {
      const group = nodes.get(object.id);
      if (!group) continue;
      if (object.kind === "path") {
        const a = objects.find(o => o.id === object.from), b = objects.find(o => o.id === object.to);
        group.querySelector("path").setAttribute("d", `M${a.x} ${a.y} C${a.x} 422 ${b.x} 422 ${b.x} ${b.y}`);
      } else group.style.transform = transform(object);
    }
  }
  function stop() { cancelMotion(); paint(current); }

  function createObject(object) {
    const group = element("g", { "data-object-id": object.id, "data-subject": object.kind });
    syncParts(group, object);
    if (object.kind === "path") group.append(element("path", { fill: "none", stroke: "#d8b97b",
      "stroke-width": 13, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    return group;
  }

  function syncParts(group, object) {
    const seed = Number(object.id.replace(/\D/g, "")) || 1;
    const parts = objectShapes(object);
    group.querySelectorAll("[data-part]").forEach(node => {
      if (!parts.some(([part]) => part === node.dataset.part)) node.remove();
    });
    parts.forEach(([part, d], index) => {
      const old = group.querySelector(`[data-part="${part}"]`);
      if (old?.dataset.geometry === d) return;
      const color = fill(part, object);
      const asset = compiledAssets[drawingCatalog[object.kind]?.asset];
      const path = asset ? element("path", { ...asset[index], fill: color, transform: "translate(-80 -160) scale(5)" }) : rough ? rough.path(d, { seed: seed * 10 + index + 1, stroke: ink, strokeWidth: 2.2,
        fill: color, fillStyle: "solid", roughness: 0.55, bowing: 0.4 }) :
        element("path", { d, fill: color, stroke: ink, "stroke-width": 2.2, "stroke-linejoin": "round" });
      path.dataset.part = part;
      path.dataset.geometry = d;
      if (old) old.replaceWith(path); else group.append(path);
    });
  }

  function paint(next) {
    cancelMotion(); changes = [];
    for (const [id, group] of nodes) {
      if (!next.objects.some(o => o.id === id)) { group.remove(); nodes.delete(id); }
    }
    for (const object of next.objects) {
      let group = nodes.get(object.id);
      const before = visible?.objects.find(o => o.id === object.id);
      if (!group) {
        group = createObject(object); nodes.set(object.id, group);
        object.kind === "path" ? svg.prepend(group) : svg.append(group);
        changes.push({ group, added: true });
      } else if (JSON.stringify(before) !== JSON.stringify(object)) changes.push({ group, before, after: object });
      if (object.kind === "path") {
        const a = next.objects.find(o => o.id === object.from), b = next.objects.find(o => o.id === object.to);
        group.querySelector("path").setAttribute("d", "M" + a.x + " " + a.y + " C" + a.x + " 422 " + b.x + " 422 " + b.x + " " + b.y);
        group.dataset.from = a.id; group.dataset.to = b.id;
      } else {
        syncParts(group, object);
        group.style.transform = transform(object);
        group.querySelectorAll("[data-part]").forEach(part => {
          const color = fill(part.dataset.part, object);
          const paths = part.matches("path") ? [part] : part.querySelectorAll("path");
          paths.forEach(path => { if (path.getAttribute("fill") !== "none") path.setAttribute("fill", color); });
        });
      }
    }
    container.dataset.subjects = [...new Set(next.objects.map(o => o.kind))].join(",");
    container.dataset.revision = String(next.revision);
    visible = next;
  }

  paint(current);
  return {
    update(next) {
      const normalized = normalizeDrawingScene(next);
      if (normalized && normalized.revision !== current.revision) { current = normalized; paint(normalized); }
      else if (normalized && JSON.stringify(normalized.steps) !== JSON.stringify(current.steps)) {
        current = normalized; paint(normalized);
      }
    },
    prepare() {
      if (current.presentation) paint({ ...current, objects: current.presentation.initialObjects });
      container.dataset.step = "-1";
    },
    step(index = 0) {
      if (!Number.isInteger(index) || index < 0 || index >= current.steps.length) return;
      const before = visible.objects;
      if (current.presentation) paint({ ...current, objects: current.presentation.frames[index] });
      else cancelMotion();
      container.dataset.step = String(index);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      for (const change of changes) {
        const moving = change.before && change.after && transform(change.before) !== transform(change.after);
        if (!moving) animations.push(change.group.animate([{ opacity: change.added ? 0.15 : 0.65 }, { opacity: 1 }],
          { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }));
      }
      // Objects and attached roads share one clock, so endpoints never jump ahead of a moving house.
      const after = visible.objects;
      if (!after.some(o => before.some(b => b.id === o.id && transform(b) !== transform(o)))) return;
      const start = performance.now();
      const tick = now => {
        const progress = Math.min(1, (now - start) / 360);
        const eased = 1 - Math.pow(1 - progress, 3);
        geometry(after.map(o => {
          const b = before.find(item => item.id === o.id);
          return b ? { ...o, x: b.x + (o.x - b.x) * eased, y: b.y + (o.y - b.y) * eased,
            scale: b.scale + (o.scale - b.scale) * eased } : o;
        }));
        if (progress < 1) motionFrame = requestAnimationFrame(tick);
      };
      tick(start);
    },
    stop,
    destroy() { cancelMotion(); nodes.clear(); container.replaceChildren(); }
  };
}
