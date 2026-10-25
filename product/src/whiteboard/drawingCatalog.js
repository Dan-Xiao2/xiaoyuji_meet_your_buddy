// One registry feeds intent matching, scene validation and the model's capability list.
export const drawingCatalog = {
  house: { label: "房子", aliases: ["房子", "小屋", "房屋", "房顶", "屋顶"], drawAliases: ["房子", "小屋", "房屋"], layer: "ground", color: "#efc76e" },
  sun: { label: "太阳", aliases: ["太阳"], layer: "sky", color: "#efc76e" },
  tree: { label: "树", aliases: ["小树", "大树", "树"], layer: "ground", color: "#93b69b" },
  cloud: { label: "云朵", aliases: ["云朵", "白云", "云"], layer: "sky", color: "#87bbc9" },
  rabbit: { label: "小兔", aliases: ["小兔子", "兔子", "小兔", "兔"], layer: "ground", color: "#ffffff", asset: "rabbit", colorPart: "身体", tintPaths: [1] },
  car: { label: "汽车", aliases: ["小汽车", "汽车", "小轿车", "轿车"], layer: "ground", color: "#df837a", asset: "car", colorPart: "车身", tintPaths: [0] },
  path: { label: "小路", aliases: ["小路", "道路"], layer: "connection", color: "#efc76e" }
};
export const drawableKinds = Object.keys(drawingCatalog).filter(kind => drawingCatalog[kind].layer !== "connection");
export const drawingAliases = Object.fromEntries(Object.entries(drawingCatalog).map(([kind, entry]) => [kind, new RegExp(entry.aliases.join("|"))]));
export const drawingSubjectPattern = new RegExp(Object.values(drawingCatalog).flatMap(entry => entry.drawAliases || entry.aliases).sort((a, b) => b.length - a.length).join("|"), "g");
export const isGroundObject = object => drawingCatalog[object.kind]?.layer === "ground";

export function drawingCatalogContext() {
  return drawableKinds.map(kind => ({ kind, label: drawingCatalog[kind].label, layer: drawingCatalog[kind].layer,
    colorPart: drawingCatalog[kind].colorPart || "主体", editable: kind === "house" ? "颜色、位置、大小、门窗" : "主体颜色、位置、大小" }));
}
