import { drawingAliases, drawingCatalogContext } from "./drawingCatalog.js";

export const unsupportedAssetDetail = input => /车轮|轮胎|车窗|车门|车灯|耳朵|兔耳|兔眼|尾巴|兔.*眼睛/.test(input) &&
  /画|加|改|变|换|涂|大一点|小一点|删除|去掉/.test(input);

// Explicit whole-object protection is checked against every playback frame, not model prose.
export function drawingConstraints(input, scene) {
  const protectedIds = new Set(), remaining = [];
  let valid = true;
  for (const clause of String(input).split(/[，,。；;]+/).map(s => s.trim()).filter(Boolean)) {
    const match = clause.match(/^(?:保持)(.+?)不变[吧呀]*$/) ||
      clause.match(/^(.+?)(?:不要变|别动|不动|保持不变)[吧呀]*$/) ||
      clause.match(/^(?:不要动|别动|不要改|别改)(.+?)[吧呀]*$/);
    if (!match) { remaining.push(clause); continue; }
    const reference = match[1].replace(/^(?:其他的?|那只|这只|那辆|这辆|那棵|这棵)/, "");
    const kinds = Object.keys(drawingAliases).filter(kind => drawingAliases[kind].test(reference));
    const unparsed = kinds.reduce((s, kind) => s.replace(new RegExp(drawingAliases[kind].source, "g"), ""), reference).trim();
    const objects = scene?.objects.filter(o => kinds.includes(o.kind)) || [];
    if (!objects.length || unparsed) valid = false;
    objects.forEach(o => protectedIds.add(o.id));
  }
  return { valid, protectedIds: [...protectedIds], input: remaining.join("，") };
}

export function preservesDrawingObjects(before, after, constraints) {
  if (!constraints.valid) return false;
  const frames = [...(after.presentation?.frames || []), after.objects];
  return constraints.protectedIds.every(id => frames.every(objects =>
    JSON.stringify(before.objects.find(o => o.id === id)) === JSON.stringify(objects.find(o => o.id === id))));
}

export function drawingPlannerContext(scene, input) {
  const constraints = drawingConstraints(input, scene);
  return { id: scene.id, revision: scene.revision, nextId: scene.nextId, objects: scene.objects,
    availableObjects: drawingCatalogContext(), protectedIds: constraints.protectedIds };
}
