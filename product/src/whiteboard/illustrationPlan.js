import { drawingKinds, drawingColors, validDrawingScene, validLegacyDrawing, normalizeDrawingScene,
  createDrawingScene, applyDrawingOperations, houseDetailDefaults } from "./drawingScene.js";
import { attachDrawingPresentation } from "./drawingTimeline.js";
import { drawingAliases, drawingSubjectPattern } from "./drawingCatalog.js";
import { drawingConstraints, preservesDrawingObjects, unsupportedAssetDetail } from "./drawingConstraints.js";

export const drawingSubjects = drawingKinds;
export const drawingCapability = "小宇有白板：可组合" + Object.entries(drawingKinds).filter(([kind]) => kind !== "path").map(([, label]) => label).join("、") + "，连接两座房子的小路；可修改指定对象的颜色、大小、左右位置、复制、放在同层对象左或右边、删除和撤销。汽车颜色只改车身，小兔颜色只改身体，保留其他细节。房子可改拱门/方门及门色，设置0到4扇圆形/方形窗户及统一窗色；不能单独改某一扇窗或任意部件。明确指令由受约束的画布执行，不要说完全不会画画；不支持的对象或细节不能声称已画好。";
export const conversationPrinciple = "跟随本轮话题，短追问沿用最近真正讨论的对象；不确定代词指什么时只问一句澄清。历史兴趣、知识卡和旧练习不能替用户换话题；不要主动从太阳转到积木、数数或故事。离屏建议必须与正在讨论的内容有关，不必每轮安排活动。允许只回应不提问；不要每轮要求选颜色、选选项或说明理由。用户已回答、拒绝或换话题时，不重复追问旧问题。自然平和，不用夸张赞美和固定开场白填充回答。";
export const drawingExecutionRule = "普通聊天回复不会执行画布操作。没有通过画布规划器执行时，不得声称已经画好、改好、放大、涂色或让用户看一个不存在的图；也不要自行提议修改尚未支持的门窗等部件。";
const aliases = drawingAliases;
const numbers = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

export function validIllustrationScene(board) {
  return board?.type === "scene" && (validDrawingScene(board.scene) || validLegacyDrawing(board.scene));
}

function result(scene, reply, pending = null, changed = false) {
  if (scene && !changed) {
    scene = { ...scene, steps: [{ text: reply }] };
    delete scene.presentation;
  } else if (scene && !scene.presentation) scene = { ...scene, steps: [{ text: reply }] };
  if (scene?.presentation) reply = scene.steps.map(step => step.text).join("");
  return { board: scene ? { type: "scene", title: "一起画", scene } : { type: "blank" },
    reply, pending, changed, segments: scene?.steps || [{ text: reply }] };
}

function askPlanner(scene) {
  return { ...result(scene, "这一步我还没弄清楚。你能换个说法吗？"), needsPlanner: true };
}

function select(text, objects) {
  const kinds = Object.keys(aliases).filter(key => aliases[key].test(text));
  let candidates = objects.filter(o => !kinds.length || kinds.includes(o.kind));
  const color = Object.keys(drawingColors).find(key => text.includes(key));
  if (color) candidates = candidates.filter(o => (o.kind === "house" ? o.roofColor : o.color) === drawingColors[color]);
  const ordinal = text.match(/第([一二三四五六七八九十\d]+)/);
  if (ordinal) {
    const i = numbers[ordinal[1]] || Number(ordinal[1]);
    candidates = candidates[i - 1] ? [candidates[i - 1]] : [];
  }
  if (candidates.length && /左|右|最[大小高矮]|[大小]房子/.test(text)) {
    const metric = /左|右/.test(text) ? o => o.x : o => o.scale;
    const values = candidates.map(metric);
    const value = /左|最小|最矮|小房子/.test(text) ? Math.min(...values) : Math.max(...values);
    candidates = candidates.filter(o => metric(o) === value);
  }
  return candidates;
}

function run(scene, operations, reply) {
  const applied = applyDrawingOperations(scene, { baseRevision: scene.revision, operations });
  if (applied.ok) return result(attachDrawingPresentation(scene, operations, applied.scene, reply), reply, null, true);
  const messages = { capacity: "画纸有点挤了。先去掉哪个，再添新的？", history: "已经回到这幅画最开始的时候了。",
    unchanged: "画面已经是这样啦。", invalid: "这一步我还没弄清楚。我们一次改一个地方好吗？" };
  return result(scene, messages[applied.reason] || "我没找到要改的那个。你说的是哪个？");
}

function targeted(scene, text, action) {
  const candidates = select(text, scene.objects);
  if (candidates.length !== 1) return result(scene,
    candidates.length ? "你说的是哪一个？可以告诉我左边、右边，或者第几个。" : "画里还没有找到它。你说的是哪个？",
    { revision: scene.revision, action, candidates: candidates.map(o => o.id) });
  const o = candidates[0];
  const patch = { ...action.patch };
  if (action.delta) patch.scale = Math.round(Math.min(1.2, Math.max(0.65, o.scale + action.delta)) * 100) / 100;
  if (action.windowDelta) {
    patch.windowCount = (o.windowCount ?? houseDetailDefaults.windowCount) + action.windowDelta;
    if (patch.windowCount < 0 || patch.windowCount > 4) return result(scene, "这座小屋可以画零到四扇窗。你想留几扇？");
  }
  const planned = run(scene, [{ op: action.op, id: o.id, ...(action.op === "update" ? { patch } : {}),
    ...(action.op === "move" ? { direction: action.direction } : {}) }], action.windowDelta ? `现在这座房子有${patch.windowCount}扇窗户。` : action.reply);
  if (["door", "window"].includes(action.detailPart)) planned.detailFocus = {
    revision: planned.board.scene.revision, id: o.id, part: action.detailPart
  };
  return planned;
}

function houseDetailPlan(text, scene) {
  if (!/门|窗/.test(text) || !/画|添|加|改|换|变|涂|刷|想要|我要|去掉|删|擦|不要|少|多/.test(text)) return null;
  // Never interpret an individual window's location or size as the house's location or size.
  if (/烟囱|大一点|小一点|变大|变小|放大|缩小|然后|并且|同时|再把|每座|所有房|两.*房|三个房/.test(text) ||
      (/门/.test(text) && /窗/.test(text)) || /左边的?窗|右边的?窗|第.*扇|上面.*窗|下面.*窗/.test(text)) return askPlanner(scene);
  const window = /窗/.test(text);
  if (Object.keys(drawingColors).filter(key => text.includes(key)).length > 1) return askPlanner(scene);
  const color = Object.keys(drawingColors).find(key => text.includes(key));
  const countMatch = text.match(/([零一二两三四五六七八九十\d]+)\s*扇/);
  const count = countMatch ? numbers[countMatch[1]] ?? Number(countMatch[1]) : null;
  const patch = {};
  const round = /圆|拱/.test(text), square = /方/.test(text);
  if (round && square) return askPlanner(scene);
  if (round || square) patch[window ? "windowShape" : "doorShape"] = window ? (round ? "round" : "square") : (round ? "arched" : "rect");
  if (color) patch[window ? "windowColor" : "doorColor"] = drawingColors[color];
  let windowDelta;
  if (window && countMatch) {
    if (!Number.isInteger(count) || count < 0 || count > 4) return { ...result(scene, "这座小屋可以画零到四扇窗。你想留几扇？"), needsPlanner: count > 4 };
    if (/加|添|多/.test(text)) windowDelta = count;
    else if (/去掉|删|擦|少/.test(text)) windowDelta = -count;
    else patch.windowCount = count;
  } else if (window && /去掉.*窗|删.*窗|擦.*窗|不要.*窗/.test(text)) patch.windowCount = 0;
  if (!Object.keys(patch).length && !windowDelta) return askPlanner(scene);
  // Defer unrecognised qualifiers rather than applying only the recognised colour/shape.
  const rest = text.replace(/红色|蓝色|黄色|绿色|紫色|房子|房屋|小屋|窗户|窗子|窗|门|屋|拱|圆形|方形|长方形|圆圆|圆|方方|方|形的|形|左边|右边|中间|左|右|第[一二两三\d]+[个座栋]?|所有|全部|都|再|给|帮|我|把|这座|那座|这个|那个|一座|座|的|想要|我要|要|改成|换成|变成|涂成|刷成|改为|改|画|添|加上|加|去掉|删除|删掉|擦掉|不要|少|多|成|留|扇|[零一二两三四\d]|请|你|可以|能不能|吗|吧|一下|[\s，。？！、,.?!]/g, "");
  if (rest) return askPlanner(scene);
  const selection = text.replace(/窗户|窗子|窗|门/g, "").replaceAll(color || "\0", "") + "房子";
  const changes = [];
  if (patch.doorShape) changes.push(patch.doorShape === "arched" ? "门改成拱形" : "门改成长方形");
  if (patch.windowShape) changes.push(patch.windowShape === "round" ? "窗户改成圆形" : "窗户改成方形");
  if (patch.windowCount !== undefined) changes.push(`保留${patch.windowCount}扇窗户`);
  if (color) changes.push(`${window ? "窗户" : "门"}涂成${color}`);
  return targeted(scene, selection, { op: "update", patch, windowDelta, detailPart: window ? "window" : "door", reply: changes.join("，") + "。" });
}

// Small language adapter; identity, validation and mutations live in drawingScene.js.
// A model planner can later produce the same operations without changing rendering or storage.
export function resolveIllustrationPlan(input, state = {}) {
  const previous = validIllustrationScene(state.board) ? normalizeDrawingScene(state.board.scene) : null;
  if (unsupportedAssetDetail(input)) return { ...result(previous, "这个细节我暂时还不能单独改，先保留原来的画。"), needsPlanner: true };
  const constraints = drawingConstraints(input, previous);
  if (!constraints.valid) return result(previous, "你想保持哪个不变？可以告诉我它的名字。");
  const pending = state.visualPlan?.pending;
  if (previous && pending?.revision === previous.revision && Array.isArray(pending.protectedIds) &&
      /^(?:就|是|那个|这)?(?:左|右|第|最大的|最小的|红色|蓝色|黄色|绿色|紫色|白色|嗯|好|对|行|谢谢)/.test(constraints.input)) {
    constraints.protectedIds = [...new Set([...constraints.protectedIds, ...pending.protectedIds])];
  }
  if (constraints.protectedIds.length && !constraints.input) return result(previous, "好，先保持这幅画。");
  const plan = resolvePlan(constraints.input.replace(/车身/g, "汽车"), state);
  if (plan?.pending && constraints.protectedIds.length) plan.pending = { ...plan.pending, protectedIds: constraints.protectedIds };
  if (plan?.changed && previous && !preservesDrawingObjects(previous, plan.board.scene, constraints))
    return result(previous, "这一步会动到你想保留的部分。我先不改，你想把它放在哪里？");
  return plan;
}

function resolvePlan(input, state = {}) {
  const text = String(input).trim().replace(/^[，,。.!！?？\s]+/, "");
  const previous = validIllustrationScene(state.board) ? normalizeDrawingScene(state.board.scene) : null;
  const focus = state.visualPlan?.detailFocus;
  const focused = previous && focus?.revision === previous.revision && ["door", "window"].includes(focus.part) &&
    previous.objects.find(o => o.id === focus.id && o.kind === "house");
  if (/^我想画画[。！!？?\s]*$/.test(text)) return null;
  if (/^我(?:喜欢|爱|正在|在)画/.test(text) && !/帮我|给我|请你/.test(text)) return null;
  if (/不(?:要|用|想).*画|别画|停止画|昨天|我画了|为什么|怎么会|怎么画|教我画/.test(text)) return null;
  if (/换个话题|换一个话题|换衣|改天|长大|画.*(?:什么意思|是什么)/.test(text)) return null;
  if (previous && /^(?:嗯+|恩+|好+|好的|好呀|可以|对|行|谢谢)[吧呀啊呢哦。！!？?\s]*$/.test(text)) {
    return { ...result(previous, state.visualPlan?.pending ? "你想改哪一个？告诉我左边、右边，或者第几个吧。" : "嗯，我们接着看这幅画。", state.visualPlan?.pending || null), ...(focused ? { detailFocus: focus } : {}) };
  }
  if (previous && /发给我看|给我看看|画给我看|看不[到见]|没(?:有)?看到|展示(?:一下|出来|给)|图在哪|画在哪/.test(text)) {
    return { ...result(previous, "我把这幅画显示在画纸上。", null, false), ...(focused ? { detailFocus: focus } : {}) };
  }
  if (focused && /^(?:那|就|把它|它)?(?:改成|换成|涂成|要|我要)?(?:[红蓝黄绿紫]色?|圆圆的?|圆形|方形|长方形)[吧的。！!？?\s]*$/.test(text)) {
    const index = previous.objects.filter(o => o.kind === "house").findIndex(o => o.id === focus.id);
    const value = text.replace(/^(?:那|就|把它|它)?(?:改成|换成|涂成|要|我要)?/, "").replace(/[吧的。！!？?\s]+$/, "");
    const normalized = /^[红蓝黄绿紫]$/.test(value) ? value + "色" : value;
    return houseDetailPlan(`把第${index + 1}座房子的${focus.part === "window" ? "窗户" : "门"}改成${normalized}`, previous);
  }
  if (previous && /(?:照着|复制|一模一样|一样的|旁边|左侧|右侧)/.test(text) &&
      /画|添|加|复制|放|移|挪/.test(text)) return askPlanner(previous);
  if (previous) {
    const detail = houseDetailPlan(text, previous);
    if (detail) return detail;
  }
  if (previous && /门|窗|烟囱/.test(text) && /画|添|加|改|换|变|放大|缩小|大一点|小一点|想要/.test(text)) return askPlanner(previous);
  const color = Object.keys(drawingColors).find(key => text.includes(key) || new RegExp(key[0] + "(?:顶|的|一点|[。！!？?]?$)").test(text));
  const colorPreference = previous && (/^(?:就|要|我选)?[红蓝黄绿紫]色?[的吧。！!？?\s]*$/.test(text) ||
    (/[色顶]|房子|小屋/.test(text) && /想要|我要|希望|改色|换个颜色|换颜色|变成/.test(text)));
  const isEdit = /改成|换成|涂|变[大小红蓝黄绿紫白]|[大小]一点|放到|放在|移到|移去|去掉|删除|擦掉|撤销|退回|清空|重新画/.test(text) || colorPreference;
  const isDraw = /画|绘制/.test(text);
  const isAdd = previous && /再.*(?:加|画)|加(?:上|一|个|棵|朵|两|三)|添/.test(text);
  if (!previous && !isDraw) return null;
  const pending = state.visualPlan?.pending;
  if (!isEdit && !isDraw && !isAdd) {
    const isSelection = /^(?:就|是|那个|这)?(?:左|右|第|最大的|最小的|红色|蓝色|黄色|绿色|紫色)/.test(text);
    if (previous && pending?.planner && pending.revision === previous.revision && isSelection) return askPlanner(previous);
    if (previous && Array.isArray(pending?.candidates) && pending.revision === previous.revision && isSelection) {
      const matches = select(text, previous.objects.filter(o => pending.candidates.includes(o.id)));
      if (matches.length === 1) {
        const index = previous.objects.filter(o => o.kind === matches[0].kind).findIndex(o => o.id === matches[0].id);
        return targeted(previous, `第${index + 1}个${drawingKinds[matches[0].kind]}`, pending.action);
      }
      return result(previous, "我还没确定是哪一个。你说的是左边还是右边？", pending);
    }
    if (previous && /^(把|让|请|帮我|能不能|再|它|这个|那个|屋顶)/.test(text) && /刷|弄|缩|挪|移|换|改|更大|更小|更高|更矮/.test(text)) return askPlanner(previous);
    return null;
  }
  if (/然后|并且|同时|顺便|再把|再删除|[，,。].*再画/.test(text) ||
      (previous && isEdit && /都|全部|每[个座棵朵]|所有/.test(text))) return askPlanner(previous);
  if (/恐龙|飞机|猫|狗|城堡|宇宙飞船/.test(text)) return askPlanner(previous);
  if (/撤销|退回上一步/.test(text)) return previous ? run(previous, [{ op: "undo" }], "回到上一步。") : result(null, "我们还没有开始画呢。");
  if (/清空/.test(text)) return previous ? run(previous, [{ op: "clear" }], "画纸清空了。") : result(null, "画纸还是空的。");
  if (isEdit && !/重新画/.test(text)) {
    if (!previous) return result(null, "我们还没有画呢。你想画什么？");
    const remove = /去掉|删除|擦掉/.test(text);
    const move = text.match(/(?:放到|放在|移到|移去)(?:最)?(左|右|中)/);
    const resize = /变大|大一点|变小|小一点/.test(text);
    const targetText = text.split(/(?:改成|换成|涂成|变成|变[红蓝黄绿紫白]|变大|变小|放到|放在|移到|移去|大一点|小一点)/)[0];
    if (remove) return targeted(previous, targetText, { op: "remove", reply: "把它擦掉了。" });
    if (move) return targeted(previous, targetText, { op: "move", direction: { 左: "left", 右: "right", 中: "center" }[move[1]], reply: "把它移到" + move[1] + "边。" });
    if (resize) return targeted(previous, targetText, { op: "update", delta: /变小|小一点/.test(text) ? -0.2 : 0.2, reply: /变小|小一点/.test(text) ? "让它小一点。" : "让它大一点。" });
    if (color) {
      const roof = /屋顶|房顶|[红蓝黄绿紫]色?顶/.test(text);
      const selector = targetText.replaceAll(color, "").replace(new RegExp(color[0] + "(?=顶|的|一点|[。！!？?]?$)", "g"), "") + (roof ? "屋顶" : "");
      return targeted(previous, selector, { op: "update", patch: { [roof ? "roofColor" : "color"]: drawingColors[color] }, reply: "把" + (roof ? "屋顶" : "它") + "换成" + color + "。" });
    }
    return askPlanner(previous);
  }
  if (/小路|道路/.test(text)) {
    const houses = previous?.objects.filter(o => o.kind === "house") || [];
    if (houses.length !== 2) return result(previous, "小路要连哪两座房子？我们先画两座房子吧。");
    return run(previous, [{ op: "connect", from: houses[0].id, to: houses[1].id }], "用一条小路把两座房子连起来。");
  }
  const kinds = Object.keys(aliases).filter(k => aliases[k].test(text));
  if (!kinds.length) return /会画|能画什么/.test(text)
    ? result(previous, "你可以告诉我想画什么，我们一起试试。") : askPlanner(previous);
  // Reject unparsed subjects/attributes instead of executing the recognized half of a request.
  const remainder = text.replace(drawingSubjectPattern, "")
    .replace(/重新|再|帮我|给我|请你|请|可以|能不能|能|你|一下|画画|绘制|画|加上|添加|加|添|个|座|栋|棵|朵|只|辆|和|还有|的|吧|好吗|好不好|吗|[一二两三四五六七八九十\d\s，。？！、,.?!]/g, "");
  if (remainder) return askPlanner(previous);
  if (/[-负]|\d+[.点]\d+/.test(text)) return result(previous, "我们先画一到三个完整的东西，好吗？");
  const quantity = text.match(/([零一二两三四五六七八九十\d]+)\s*[个座栋棵朵只辆]/);
  const count = quantity ? numbers[quantity[1]] || Number(quantity[1]) : 1;
  if (!Number.isInteger(count) || count < 1 || count > 3 || (kinds.length > 1 && quantity))
    return result(previous, "我们先画一到三个同样的东西，好吗？");
  if (/大小不同|一大一小|高矮不同/.test(text)) return result(previous, "我们先画出来，再说哪一个大一点，好吗？");
  const scene = previous || createDrawingScene("drawing-" + (state.session?.id || "local"));
  const operations = [...(/重新画/.test(text) && scene.objects.length ? [{ op: "clear" }] : []),
    ...kinds.map(kind => ({ op: "add", kind, count }))];
  return run(scene, operations, "画" + (count > 1 ? count + "个" : "") + kinds.map(k => drawingKinds[k]).join("、") + "。");
}
