export function createBlockScene(container, scene) {
  const K = window.Konva;
  if (!K) { container.textContent = "画纸暂时没有打开，仍然可以继续聊。"; return { update() {}, step() {}, stop() {}, destroy() {} }; }
  container.innerHTML = '<div class="block-scene-canvas"></div><p class="block-scene-count" aria-live="polite"></p><div class="sr-only block-scene-access"></div>';
  const host = container.querySelector(".block-scene-canvas");
  const count = container.querySelector(".block-scene-count");
  const access = container.querySelector(".block-scene-access");
  const stage = new K.Stage({ container: host, width: 1, height: 460 });
  const layer = new K.Layer(); stage.add(layer);
  const background = new K.Group(); layer.add(background);
  const nodes = new Map();
  const selected = new Set();
  const tweens = new Map();
  let current = scene;
  let shownGiven = scene.fromGiven;
  let width = 1;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  function stop() { for (const tween of tweens.values()) tween.destroy(); tweens.clear(); }
  function location(index) {
    const mobile = width < 620;
    const remaining = current.total - shownGiven;
    const other = index >= remaining;
    const offset = other ? index - remaining : index;
    const groupWidth = mobile ? width : width / 2;
    const groupCount = other ? shownGiven : remaining;
    const columns = Math.min(5, groupCount);
    const start = (groupWidth - columns * 58 + 10) / 2;
    return {
      x: (mobile || !other ? 0 : width / 2) + start + (offset % 5) * 58,
      y: (mobile && other ? 285 : 100) + Math.floor(offset / 5) * 66
    };
  }
  function select(index) {
    if (selected.has(index)) selected.delete(index); else selected.add(index);
    nodes.get(index).findOne(".block-front").stroke(selected.has(index) ? "#c67932" : "#285955");
    nodes.get(index).findOne(".block-front").strokeWidth(selected.has(index) ? 4 : 2);
    count.textContent = selected.size ? `数到 ${selected.size} 块` : "";
    access.querySelector(`[data-index="${index}"]`)?.setAttribute("aria-pressed", String(selected.has(index)));
    layer.batchDraw();
  }
  function paint(animate = false) {
    stop();
    const mobile = width < 620;
    const groupWidth = mobile ? width : width / 2;
    stage.size({ width, height: mobile ? 460 : 310 });
    background.destroyChildren();
    for (const [other, label] of [[false, "你这里"], [true, current.recipient + "那里"]]) {
      const x = mobile || !other ? 0 : width / 2;
      const y = mobile && other ? 240 : 54;
      background.add(new K.Text({ x, y, width: groupWidth, text: label, align: "center", fontSize: 18, fontFamily: "sans-serif", fill: "#285955" }));
      background.add(new K.Line({ points: [x + 18, y + 174, x + groupWidth - 18, y + 174], stroke: "#dce5e2", strokeWidth: 2 }));
    }
    for (const [index, node] of nodes) if (index >= current.total) { node.destroy(); nodes.delete(index); selected.delete(index); }
    for (let index = 0; index < current.total; index++) {
      let node = nodes.get(index);
      if (!node) {
        node = new K.Group({ id: `block-${index}` });
        const color = ["#efae63", "#84bac4", "#dc958c"][index % 3];
        node.add(new K.Rect({ name: "block-front", width: 44, height: 44, y: 8, cornerRadius: 5, fill: color, stroke: "#285955", strokeWidth: 2 }));
        node.add(new K.Line({ points: [3, 8, 11, 1, 49, 1, 44, 8], closed: true, fill: "#f6ead4", stroke: "#285955", strokeWidth: 2, lineJoin: "round" }));
        node.add(new K.Line({ points: [44, 8, 49, 1, 49, 42, 44, 50], closed: true, fill: color, stroke: "#285955", strokeWidth: 2, lineJoin: "round" }));
        node.on("click tap", () => select(index));
        node.on("mouseenter", () => { host.style.cursor = "pointer"; });
        node.on("mouseleave", () => { host.style.cursor = ""; });
        layer.add(node); nodes.set(index, node); node.position(location(index));
      }
      if (animate && !reduced.matches) {
        const tween = new K.Tween({ node, ...location(index), duration: 0.55, easing: K.Easings.EaseInOut });
        tweens.set(index, tween); tween.play();
      } else node.position(location(index));
    }
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", `${current.total}块积木，你这里${current.total - shownGiven}块，${current.recipient}那里${shownGiven}块`);
    access.replaceChildren();
    for (let index = 0; index < current.total; index++) {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = `数第${index + 1}块积木`;
      button.dataset.index = index; button.setAttribute("aria-pressed", String(selected.has(index)));
      button.onclick = () => select(index); access.append(button);
    }
    container.dataset.given = String(shownGiven);
    container.dataset.total = String(current.total);
    layer.batchDraw();
  }
  const observer = new ResizeObserver(() => {
    const next = Math.floor(container.clientWidth);
    if (next > 0 && next !== width) { width = next; paint(); }
  });
  observer.observe(container);
  return {
    update(next) {
      if (next.revision === current.revision) return;
      current = next; shownGiven = next.fromGiven; selected.clear(); count.textContent = ""; paint();
      for (const node of nodes.values()) { node.findOne(".block-front").stroke("#285955"); node.findOne(".block-front").strokeWidth(2); }
      layer.batchDraw();
    },
    step(index) {
      const step = current.steps[index]; if (!step) return;
      shownGiven = step.given; selected.clear(); count.textContent = "";
      for (const node of nodes.values()) { node.findOne(".block-front").stroke("#285955"); node.findOne(".block-front").strokeWidth(2); }
      paint(true);
    },
    stop,
    destroy() { observer.disconnect(); stop(); stage.destroy(); container.replaceChildren(); }
  };
}
