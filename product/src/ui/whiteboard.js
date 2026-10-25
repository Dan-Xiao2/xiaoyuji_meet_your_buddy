import { createBlockScene } from "./blockScene.js";
import { createIllustrationScene } from "./illustrationScene.js";
import { validVisualScene } from "../whiteboard/visualPlan.js";
import { validImageBoard } from "../whiteboard/openDrawing.js";

const mounted = new WeakMap();
export function stopWhiteboardPlayback(container) {
  const current = mounted.get(container);
  current?.timers?.forEach(clearTimeout);
  if (current) current.timers = [];
  current?.player?.stop();
}
export function presentWhiteboardStep(container, index) {
  mounted.get(container)?.player?.step(index);
}
export function prepareWhiteboardPlayback(container) {
  mounted.get(container)?.player?.prepare?.();
}
export function replayWhiteboard(container) {
  const current = mounted.get(container);
  if (!current?.player) return;
  stopWhiteboardPlayback(container);
  prepareWhiteboardPlayback(container);
  current.scene.steps.forEach((_, index) => {
    current.timers.push(setTimeout(() => current.player.step(index), index * 1200));
  });
}
export function renderWhiteboard(container, board = { type: "blank" }) {
  const previous = mounted.get(container);
  if (validImageBoard(board)) {
    const key = board.id + ":" + board.revision + ":" + board.image;
    if (previous?.key === key) return;
    stopWhiteboardPlayback(container); previous?.player?.destroy();
    mounted.set(container, { key });
    container.classList.remove("is-empty");
    container.innerHTML = '<div class="scene-toolbar"><span>一起画</span><div><button type="button" class="scene-replay image-undo" title="撤销" aria-label="撤销"><i data-lucide="undo-2"></i></button><button type="button" class="scene-replay image-download" title="下载图画" aria-label="下载图画"><i data-lucide="download"></i></button></div></div><div class="scene-content generated-image"><img alt="一起创作的图画"></div>';
    container.querySelector("img").src = board.image;
    container.querySelector(".image-undo").disabled = !board.history?.length;
    container.querySelector(".image-undo").onclick = () => container.dispatchEvent(new CustomEvent("drawing-undo", { bubbles: true }));
    container.querySelector(".image-download").onclick = () => {
      const link = document.createElement("a"); link.href = board.image;
      link.download = "小宇记-一起画-" + new Date().toISOString().slice(0, 10) + ".jpg"; link.click();
    };
    window.lucide?.createIcons({ root: container });
    return;
  }
  if (validVisualScene(board)) {
    container.classList.remove("is-empty");
    if (previous?.scene?.id === board.scene.id) {
      if (previous.scene.revision !== board.scene.revision) stopWhiteboardPlayback(container);
      previous.player.update(board.scene); previous.scene = board.scene; return;
    }
    stopWhiteboardPlayback(container); previous?.player?.destroy();
    const illustration = board.scene.kind === "illustration";
    container.innerHTML = '<div class="scene-toolbar"><span></span><button type="button" class="scene-replay" title="再看一次" aria-label="再看一次"><i data-lucide="rotate-ccw"></i></button></div><div class="scene-content"></div>';
    container.querySelector(".scene-toolbar span").textContent = illustration ? "一起画" : "分一分积木";
    const host = container.querySelector(".scene-content");
    host.classList.add(illustration ? "illustration-scene" : "block-scene");
    window.lucide?.createIcons({ root: container });
    const player = illustration ? createIllustrationScene(host, board.scene) : createBlockScene(host, board.scene);
    mounted.set(container, { player, scene: board.scene, timers: [] });
    container.querySelector(".scene-replay").onclick = () => container.dispatchEvent(new CustomEvent("whiteboard-replay", { bubbles: true }));
    return;
  }
  const key = JSON.stringify(board);
  if (previous?.key === key) return;
  stopWhiteboardPlayback(container); previous?.player?.destroy();
  mounted.set(container, { key });
  container.classList.toggle("is-empty", board.type === "blank");

  const renderers = {
    blank: renderBlank,
    welcome: renderWelcome,
    math: renderMath,
    english: renderEnglish,
    science: renderScience,
    algebra: renderAlgebra,
    story: renderStory,
    language: renderLanguage,
    safety: renderSafety
  };

  const body = (renderers[board.type] ?? renderBlank)(board);
  container.innerHTML = `<div class="whiteboard-body">${body}</div>`;
  roughenPrimaryLines(container);
}

function roughenPrimaryLines(container) {
  if (typeof window === "undefined" || !window.rough || !container.querySelectorAll) return;

  container.querySelectorAll("svg.sketch-canvas").forEach((svg, svgIndex) => {
    const roughSvg = window.rough.svg(svg);
    svg.querySelectorAll("path.sketch-line").forEach((path, pathIndex) => {
      const pathData = path.getAttribute("d");
      if (!pathData) return;

      const roughPath = roughSvg.path(pathData, {
        seed: 700 + svgIndex * 20 + pathIndex,
        stroke: "#6f8179",
        strokeWidth: 5,
        roughness: 0.72,
        bowing: 0.88,
        fill: "none"
      });
      const animationClasses = [...path.classList];
      roughPath.querySelectorAll("path").forEach((roughStroke) => roughStroke.classList.add(...animationClasses));
      path.before(roughPath);
      path.remove();
    });
  });
}

function renderBlank() {
  return '<div class="blank-whiteboard" role="img" aria-label="空白白板"></div>';
}

function renderWelcome(board) {
  return `
    <div class="sketch-board welcome-sketch">
      <svg class="sketch-canvas" viewBox="0 0 900 520" role="img" aria-label="小宇白板欢迎画面">
        <path class="sketch-line draw-1" d="M93 130 C185 74 312 84 388 148" />
        <path class="sketch-line draw-2" d="M512 134 C612 74 746 84 818 154" />
        <g class="sketch-pop pop-1">
          <rect class="sketch-card-shape" x="96" y="150" width="190" height="126" rx="22" />
          <text x="191" y="224" text-anchor="middle">${escapeSvg(board.items[0] || "讲故事")}</text>
        </g>
        <g class="sketch-pop pop-2">
          <rect class="sketch-card-shape warm" x="356" y="96" width="190" height="126" rx="22" />
          <text x="451" y="170" text-anchor="middle">${escapeSvg(board.items[1] || "找颜色")}</text>
        </g>
        <g class="sketch-pop pop-3">
          <rect class="sketch-card-shape cool" x="616" y="150" width="190" height="126" rx="22" />
          <text x="711" y="224" text-anchor="middle">${escapeSvg(board.items[2] || "数一数")}</text>
        </g>
        <g class="xiaoyu-doodle sketch-pop pop-4">
          <circle cx="450" cy="350" r="72" />
          <circle cx="424" cy="336" r="7" />
          <circle cx="476" cy="336" r="7" />
          <path d="M423 372 C443 392 468 392 488 372" />
          <path d="M400 300 L367 260" />
          <path d="M500 300 L533 260" />
        </g>
        <text class="sketch-caption" x="450" y="470" text-anchor="middle">按下面的语音按钮，小宇会边听边画</text>
      </svg>
    </div>
    <p class="board-note">${board.note}</p>
  `;
}

function renderMath(board) {
  const total = board.items?.length || 0;
  const applePositions = Array.from({ length: total }, (_, index) => {
    const columns = Math.min(total, 5);
    const startX = 450 - ((columns - 1) * 96) / 2;
    return {
      x: startX + (index % columns) * 96,
      y: index < 5 ? 210 : 318,
      crossed: index < board.crossed
    };
  });

  return `
    ${board.feedback ? renderFeedback(board.feedback) : ""}
    <div class="sketch-board math-sketch">
      <svg class="sketch-canvas" viewBox="0 0 900 520" role="img" aria-label="数感白板">
        <text class="sketch-title" x="450" y="70" text-anchor="middle">${escapeSvg(board.title)}</text>
        <path class="sketch-line draw-1" d="M154 112 C320 88 590 88 746 114" />
        ${applePositions
          .map(
            (apple, index) => `
              <g class="apple-doodle sketch-pop pop-${Math.min(index + 1, 4)}">
                <circle cx="${apple.x}" cy="${apple.y}" r="34" />
                <path d="M${apple.x - 5} ${apple.y - 39} C${apple.x + 6} ${apple.y - 68} ${apple.x + 34} ${apple.y - 54} ${apple.x + 17} ${apple.y - 33}" />
                ${apple.crossed ? `<path class="cross-line draw-${Math.min(index + 2, 4)}" d="M${apple.x - 45} ${apple.y + 34} L${apple.x + 45} ${apple.y - 34}" />` : ""}
              </g>
            `
          )
          .join("")}
        <g class="sketch-pop pop-4">
          <rect class="sketch-question-shape" x="270" y="390" width="360" height="74" rx="22" />
          <text class="sketch-question-text" x="450" y="438" text-anchor="middle">${escapeSvg(board.question)}</text>
        </g>
      </svg>
    </div>
    <p class="board-note">${board.note}</p>
  `;
}

function renderFeedback(feedback) {
  const answerText = feedback.answer === null ? "没有识别到明确数字" : `孩子回答：${feedback.answer}`;
  return `
    <div class="board-feedback ${feedback.correct ? "is-correct" : "needs-support"}">
      <strong>${feedback.correct ? "答对了" : "需要提示"}</strong>
      <span>${answerText}，正确答案：${feedback.expected}</span>
    </div>
  `;
}

function renderEnglish(board) {
  return `
    <div class="sketch-board word-sketch">
      <svg class="sketch-canvas" viewBox="0 0 900 520" role="img" aria-label="颜色英语白板">
        <text class="sketch-title" x="450" y="70" text-anchor="middle">${escapeSvg(board.title)}</text>
        ${board.items
          .map((item, index) => {
            const x = 190 + index * 260;
            return `
              <g class="word-doodle sketch-pop pop-${index + 1}">
                <circle cx="${x}" cy="215" r="66" fill="${escapeSvg(item.color)}" />
                <path class="word-card-line" d="M${x - 92} 314 C${x - 28} 292 ${x + 42} 292 ${x + 92} 314" />
                <text class="word-en" x="${x}" y="224" text-anchor="middle">${escapeSvg(item.en)}</text>
                <text class="word-zh" x="${x}" y="356" text-anchor="middle">${escapeSvg(item.zh)}</text>
              </g>
            `;
          })
          .join("")}
        <g class="sketch-pop pop-4">
          <rect class="sketch-question-shape" x="245" y="405" width="410" height="72" rx="22" />
          <text class="sketch-question-text" x="450" y="450" text-anchor="middle">${escapeSvg(board.question)}</text>
        </g>
      </svg>
    </div>
    <p class="board-note">${board.note}</p>
  `;
}

function renderAlgebra(board) {
  return `
    ${board.feedback ? renderAlgebraFeedback(board.feedback) : ""}
    ${
      board.visualExplanation
        ? renderDistributiveVisual(board.visualExplanation)
        : `<div class="equation-board"><strong>${board.problem.left}</strong><span>=</span><strong>${board.problem.right}</strong></div>`
    }
    <div class="board-question">${board.question}</div>
    <p class="board-note">${board.note}</p>
  `;
}

function renderAlgebraFeedback(feedback) {
  return `
    <div class="board-feedback ${feedback.correct ? "is-correct" : "needs-support"}">
      <strong>${feedback.correct ? "你发现了" : "我们换一种画法"}</strong>
      <span>${
        feedback.correct
          ? `答案是 ${escapeHtml(feedback.expected)}，再换一组数字试试看。`
          : `你刚才想的是 ${escapeHtml(feedback.answer ?? "这个答案")}，先看看每一份里面都有什么。`
      }</span>
    </div>
  `;
}

function renderDistributiveVisual(problem) {
  const rows = Array.from({ length: problem.coefficient }, (_, index) => {
    return `
      <div class="bracket-row">
        <span class="copy-label">第 ${index + 1} 份</span>
        <span class="bracket-box">x + ${problem.constant}</span>
      </div>
    `;
  }).join("");

  return `
    <div class="distributive-board">
      <div class="equation-board compact"><strong>${problem.coefficient} × (x + ${problem.constant})</strong></div>
      ${rows}
      <div class="distribution-summary">
        <span>${problem.coefficient} 个 x</span>
        <span>${problem.coefficient} 个 ${problem.constant}</span>
        <strong>${problem.coefficient}x + ${problem.coefficient * problem.constant}</strong>
      </div>
    </div>
  `;
}

function renderScience(board) {
  if (board.items?.some((item) => /红色|黄色|绿色/.test(item))) {
    return `
      <div class="sketch-board science-sketch">
        <svg class="sketch-canvas" viewBox="0 0 900 520" role="img" aria-label="找颜色白板">
          <text class="sketch-title" x="450" y="70" text-anchor="middle">${escapeSvg(board.title)}</text>
          ${board.items
            .map((item, index) => {
              const x = 190 + index * 260;
              return `
                <g class="color-doodle ${colorClass(item)} sketch-pop pop-${index + 1}">
                  <path d="M${x - 70} 180 C${x - 40} 132 ${x + 46} 132 ${x + 78} 184 C${x + 116} 246 ${x + 40} 318 ${x - 48} 296 C${x - 112} 280 ${x - 112} 222 ${x - 70} 180 Z" />
                  <text x="${x}" y="244" text-anchor="middle">${escapeSvg(item)}</text>
                </g>
              `;
            })
            .join("")}
          <g class="magnifier-doodle sketch-pop pop-4">
            <circle cx="704" cy="354" r="42" />
            <path d="M734 384 L790 440" />
          </g>
          <rect class="sketch-question-shape" x="190" y="385" width="430" height="72" rx="22" />
          <text class="sketch-question-text" x="405" y="430" text-anchor="middle">${escapeSvg(board.question)}</text>
        </svg>
      </div>
      <p class="board-note">${board.note}</p>
    `;
  }

  if (board.variant !== "moon") {
    return renderSimpleScience(board);
  }

  return `
    <div class="sketch-board orbit-sketch">
      <svg class="sketch-canvas" viewBox="0 0 900 520" role="img" aria-label="月亮变化白板">
        <text class="sketch-title" x="450" y="70" text-anchor="middle">${escapeSvg(board.title)}</text>
        <circle class="sun-doodle sketch-pop pop-1" cx="180" cy="260" r="60" />
        <text x="180" y="267" text-anchor="middle">太阳</text>
        <circle class="earth-doodle sketch-pop pop-2" cx="450" cy="260" r="48" />
        <text x="450" y="267" text-anchor="middle">地球</text>
        <path class="sketch-line draw-2" d="M450 150 C575 150 695 200 720 260 C695 320 575 370 450 370" />
        <circle class="moon-doodle sketch-pop pop-3" cx="720" cy="260" r="36" />
        <text x="720" y="267" text-anchor="middle">月亮</text>
        <path class="sketch-line draw-3" d="M245 260 L402 260" />
        <rect class="sketch-question-shape" x="235" y="405" width="430" height="72" rx="22" />
        <text class="sketch-question-text" x="450" y="450" text-anchor="middle">${escapeSvg(board.question)}</text>
      </svg>
    </div>
    <p class="board-note">${board.note}</p>
  `;
}

function renderSimpleScience(board) {
  const items = board.items?.length ? board.items.slice(0, 3) : ["看一看", "想一想", "试一试"];
  return `
    <div class="sketch-board science-sketch">
      <svg class="sketch-canvas" viewBox="0 0 900 520" role="img" aria-label="科学解释白板">
        <text class="sketch-title" x="450" y="70" text-anchor="middle">${escapeSvg(board.title)}</text>
        <path class="sketch-line draw-1" d="M150 166 C280 96 382 128 450 210 C526 120 652 100 766 170" />
        ${items
          .map((item, index) => {
            const x = 190 + index * 260;
            return `
              <g class="science-card-doodle sketch-pop pop-${index + 1}">
                <circle cx="${x}" cy="235" r="62" />
                <path d="M${x - 70} 315 C${x - 18} 290 ${x + 38} 290 ${x + 86} 315" />
                <text x="${x}" y="244" text-anchor="middle">${escapeSvg(item)}</text>
              </g>
            `;
          })
          .join("")}
        <path class="sketch-line draw-3" d="M254 235 L386 235 M514 235 L646 235" />
        <g class="sketch-pop pop-4">
          <rect class="sketch-question-shape" x="180" y="390" width="540" height="82" rx="22" />
          <text class="sketch-small-text" x="450" y="424" text-anchor="middle">${escapeSvg(shortLine(board.question, 28, 0))}</text>
          <text class="sketch-small-text" x="450" y="454" text-anchor="middle">${escapeSvg(shortLine(board.question, 28, 1))}</text>
        </g>
      </svg>
    </div>
    <p class="board-note">${escapeHtml(board.note)}</p>
  `;
}

function renderStory(board) {
  if (board.story) {
    return `
      <div class="sketch-board story-sketch">
        <svg class="sketch-canvas" viewBox="0 0 900 560" role="img" aria-label="故事白板">
          <text class="sketch-title" x="450" y="62" text-anchor="middle">${escapeSvg(board.story.title)}</text>
          <path class="sketch-line draw-1" d="M130 390 C236 260 322 228 442 310 C560 392 660 326 770 178" />
          <g class="story-character-doodle sketch-pop pop-1">
            <circle cx="190" cy="245" r="54" />
            <circle cx="170" cy="230" r="6" />
            <circle cx="210" cy="230" r="6" />
            <path d="M170 266 C184 280 202 280 216 266" />
            <text x="190" y="336" text-anchor="middle">${escapeSvg(board.story.character)}</text>
          </g>
          <g class="story-place-doodle sketch-pop pop-2">
            <rect x="370" y="172" width="170" height="120" rx="22" />
            <path d="M390 292 C425 250 486 250 520 292" />
            <text x="455" y="340" text-anchor="middle">${escapeSvg(board.story.setting)}</text>
          </g>
          <g class="story-object-doodle sketch-pop pop-3">
            <path d="M675 165 C718 125 778 160 758 216 C744 255 690 265 660 230 C638 204 650 180 675 165 Z" />
            <text x="710" y="300" text-anchor="middle">${escapeSvg(board.story.object)}</text>
          </g>
          ${
            board.story.ending
              ? `<g class="story-ending-doodle sketch-pop pop-4">
                  <rect class="sketch-question-shape" x="205" y="405" width="490" height="92" rx="24" />
                  <text class="sketch-small-text" x="450" y="444" text-anchor="middle">${escapeSvg(shortLine(board.story.ending, 26, 0))}</text>
                  <text class="sketch-small-text" x="450" y="474" text-anchor="middle">${escapeSvg(shortLine(board.story.ending, 26, 1))}</text>
                </g>`
              : `<g class="story-choice-hint sketch-pop pop-4">
                  <rect class="sketch-question-shape" x="235" y="415" width="430" height="72" rx="22" />
                  <text class="sketch-question-text" x="450" y="460" text-anchor="middle">${escapeSvg(board.question)}</text>
                </g>`
          }
        </svg>
        ${
          board.story.domainLabels?.length
            ? `<div class="story-domain-row">${board.story.domainLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>`
            : ""
        }
        ${
          board.story.dialogicPrompts?.length
            ? `<div class="dialogic-prompt-row">
                ${board.story.dialogicPrompts
                  .map((prompt) => `<span><strong>${escapeHtml(promptTypeLabel(prompt.type))}</strong>${escapeHtml(prompt.text)}</span>`)
                  .join("")}
              </div>`
            : ""
        }
        <div class="choice-row">
          ${board.story.choices
            .map((choice) => `<button type="button" data-prompt="我选择${escapeHtml(choice)}，继续讲">${escapeHtml(choice)}</button>`)
            .join("")}
        </div>
      </div>
      <p class="board-note">${board.story.parentPrompt}</p>
    `;
  }

  return `
    <div class="story-path">
      ${board.items.map((item) => `<span>${item}</span>`).join("")}
    </div>
    <div class="board-question">${board.question}</div>
    <p class="board-note">${board.note}</p>
  `;
}

function colorClass(label) {
  if (label.includes("红")) return "is-red";
  if (label.includes("黄")) return "is-yellow";
  if (label.includes("绿")) return "is-green";
  return "";
}

function promptTypeLabel(type) {
  const labels = {
    predict: "猜一猜",
    recall: "说一说",
    relate: "连一连",
    feeling: "想一想",
    create: "变一变"
  };
  return labels[type] || "问一问";
}

function shortLine(text, size, line) {
  const start = line * size;
  return text.slice(start, start + size);
}

function escapeSvg(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderLanguage(board) {
  return `
    <div class="sketch-board sentence-sketch">
      <svg class="sketch-canvas" viewBox="0 0 900 520" role="img" aria-label="语言表达白板">
        <text class="sketch-title" x="450" y="70" text-anchor="middle">${escapeSvg(board.title)}</text>
        <path class="sketch-line draw-1" d="M134 354 C260 252 398 252 506 328 C606 400 698 388 782 286" />
        ${board.items
          .map((item, index) => {
            const x = 190 + index * 260;
            const labels = ["谁", "在哪里", "做什么"];
            return `
              <g class="sentence-doodle sentence-${index + 1} sketch-pop pop-${index + 1}">
                <rect x="${x - 82}" y="150" width="164" height="120" rx="24" />
                <text class="sentence-part" x="${x}" y="202" text-anchor="middle">${escapeSvg(item || labels[index])}</text>
                <text class="sentence-hint" x="${x}" y="238" text-anchor="middle">${escapeSvg(sentenceHint(item, index))}</text>
              </g>
            `;
          })
          .join("")}
        <g class="sketch-pop pop-4">
          <rect class="sketch-question-shape" x="225" y="390" width="450" height="78" rx="22" />
          <text class="sketch-question-text" x="450" y="438" text-anchor="middle">${escapeSvg(board.question)}</text>
        </g>
      </svg>
    </div>
    <p class="board-note">${board.note}</p>
  `;
}

function sentenceHint(item, index) {
  const hints = {
    谁: "小朋友 / 小熊",
    在哪里: "家里 / 操场",
    做什么: "发现 / 分享"
  };
  return hints[item] || ["主角", "地点", "动作"][index] || "想法";
}

function renderSafety(board) {
  return `
    <section class="safety-support" role="status">
      <h2>${escapeSvg(board.title || "先照顾好自己")}</h2>
      <p>${escapeSvg(board.note || "请找身边不会伤害你的大人帮忙。")}</p>
    </section>
  `;
}
