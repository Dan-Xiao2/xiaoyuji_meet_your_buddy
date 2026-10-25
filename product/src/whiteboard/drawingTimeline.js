import { applyDrawingOperations, drawingColors, drawingKinds } from "./drawingScene.js";

const clone = value => JSON.parse(JSON.stringify(value));
const colorNames = Object.fromEntries(Object.entries(drawingColors).map(([name, value]) => [value, name]));
colorNames["#d7eaf0"] = "浅蓝色";
const measure = kind => ({ house: "座", tree: "棵", cloud: "朵", path: "条", rabbit: "只", car: "辆" }[kind] || "个");

function describe(action, before, after) {
  const label = id => {
    const objects = after.some(o => o.id === id) ? after : before;
    const object = objects.find(o => o.id === id);
    const peers = objects.filter(o => o.kind === object?.kind);
    return object ? (peers.length > 1 ? `第${peers.findIndex(o => o.id === id) + 1}${measure(object.kind)}` : "") + drawingKinds[object.kind] : "它";
  };
  if (action.op === "add") return `画${action.count}${measure(action.kind)}${drawingKinds[action.kind]}`;
  if (action.op === "duplicate") return `照着${label(action.id)}，再画一个一样的`;
  if (action.op === "place") return `把${label(action.id)}放在${label(action.relativeTo)}${action.side === "left" ? "左" : "右"}边`;
  if (action.op === "move") return `把${label(action.id)}移到${{ left: "左边", right: "右边", center: "中间" }[action.direction]}`;
  if (action.op === "connect") return `用小路连接${label(action.from)}和${label(action.to)}`;
  if (action.op === "remove") return `擦掉${label(action.id)}`;
  if (action.op === "clear") return "清空画纸";
  if (action.op === "undo") return "回到上一步";
  const changes = [];
  if (action.patch.roofColor) changes.push("屋顶涂成" + colorNames[action.patch.roofColor]);
  if (action.patch.color) changes.push("颜色换成" + colorNames[action.patch.color]);
  if (action.patch.doorShape) changes.push("门改成" + (action.patch.doorShape === "arched" ? "拱形" : "长方形"));
  if (action.patch.doorColor) changes.push("门涂成" + colorNames[action.patch.doorColor]);
  if (action.patch.windowShape) changes.push("窗户改成" + (action.patch.windowShape === "round" ? "圆形" : "方形"));
  if (action.patch.windowColor) changes.push("窗户涂成" + colorNames[action.patch.windowColor]);
  if (action.patch.windowCount !== undefined) changes.push("保留" + action.patch.windowCount + "扇窗户");
  if (action.patch.scale !== undefined) {
    const old = before.find(o => o.id === action.id)?.scale ?? 1;
    changes.push(action.patch.scale < old ? "小一点" : action.patch.scale > old ? "大一点" : "保持这个大小");
  }
  return `让${label(action.id)}${changes.join("，")}`;
}

// The whole turn commits once. Prefixes only produce playback frames, never extra undo entries.
export function attachDrawingPresentation(source, operations, committed, singleReply) {
  const groups = [];
  let before = source.objects;
  for (let index = 0; index < operations.length; index++) {
    const prefix = applyDrawingOperations(source, { baseRevision: source.revision, operations: operations.slice(0, index + 1) });
    if (!prefix.ok) continue;
    const after = prefix.scene.objects;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const action = operations[index];
    const text = describe(action, before, after);
    const previous = groups.at(-1);
    // Apply initial attributes with their new object, avoiding a flash of the wrong colour/size.
    if (previous?.newIds.includes(action.id) && ["update", "place", "move"].includes(action.op) &&
        previous.text.length + text.length < 118) {
      previous.text += "，" + text;
      previous.objects = clone(after);
    } else {
      groups.push({ text, objects: clone(after), newIds: after.filter(o => !before.some(b => b.id === o.id)).map(o => o.id) });
    }
    before = after;
  }
  if (!groups.length) return committed;
  return { ...committed,
    steps: groups.map(group => ({ text: (groups.length === 1 && singleReply) || group.text + "。" })),
    presentation: { initialObjects: clone(source.objects), frames: groups.map(group => group.objects) }
  };
}
