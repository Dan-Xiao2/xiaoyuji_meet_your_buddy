// Draws Xiaoyu (A1 shapes, from src/ui/xiaoyuFace.js) in several drawing media so a style can be
// chosen: flat (today), crayon, coloured pencil, picture-book watercolour and cut-paper collage.
// Textures come from SVG filters; hand-drawn lines from Rough.js with fixed seeds (stable on redraw).
const NS = "http://www.w3.org/2000/svg";
const C = { sky: "#d5e7f0", planet: "#f2a061", planetDeep: "#d9783a", band: "#27534c", ink: "#27534c", cheek: "#ee8760", star: "#ffcf5c", pencil: "#4a4038" };
const BAND = "M-20 1057 C 380 1032 790 962 1000 735 L 1010 945 C 860 1082 480 1192 -20 1198 Z";
const SMILE = "M451 725 Q497 788 548 717", BIG = "M440 718 Q497 810 562 706";
let uid = 0;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent?.appendChild(node);
  return node;
}

function canvas(className) {
  const svg = el("svg", { viewBox: "-70 -70 1394 1394", class: className, "aria-hidden": "true" });
  const id = `s${uid++}`;
  svg.innerHTML = `<defs>
    <clipPath id="${id}-frame"><circle cx="627" cy="627" r="627" /></clipPath>
    <clipPath id="${id}-planet"><circle cx="434" cy="850" r="556" /></clipPath>
  </defs>`;
  return { svg, id, defs: svg.querySelector("defs"), rc: rough.svg(svg) };
}
const addDefs = (defs, markup) => defs.insertAdjacentHTML("beforeend", markup);

function faceMarkup(happy, { ink = C.ink, cheeks = true } = {}) {
  const eyes = happy
    ? `<g fill="none" stroke="${ink}" stroke-width="26" stroke-linecap="round"><path d="M262 712 Q305 660 348 712" /><path d="M640 674 Q683 622 726 674" /></g>`
    : `<g fill="${ink}"><ellipse cx="305" cy="700" rx="47" ry="50" /><ellipse cx="683" cy="662" rx="47" ry="50" /></g>`;
  const blush = happy && cheeks ? `<g fill="${C.cheek}"><ellipse cx="236" cy="790" rx="52" ry="30" /><ellipse cx="764" cy="752" rx="52" ry="30" /></g>` : "";
  return `${blush}${eyes}<path d="${happy ? BIG : SMILE}" fill="none" stroke="${ink}" stroke-width="22" stroke-linecap="round" />`;
}

// Optional crayon doodles: a star, two sparkles and a little orbit dash, all hand-drawn.
function doodles({ rc, svg }, seed) {
  const group = el("g", {}, svg);
  const star = (cx, cy, r) => Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r * .45 : r;
    return [cx + d * Math.cos(a), cy + d * Math.sin(a)];
  });
  group.appendChild(rc.polygon(star(1120, 190, 110), { seed, roughness: 2.2, stroke: "#e2a93a", strokeWidth: 10, fill: C.star, fillStyle: "zigzag", fillWeight: 12, hachureGap: 22 }));
  for (const [x, y, s] of [[150, 160, 48], [1180, 560, 34]]) {
    group.appendChild(rc.line(x - s, y, x + s, y, { seed: seed + x, roughness: 1.6, stroke: C.star, strokeWidth: 14 }));
    group.appendChild(rc.line(x, y - s, x, y + s, { seed: seed + y, roughness: 1.6, stroke: C.star, strokeWidth: 14 }));
  }
  group.appendChild(rc.arc(627, 627, 1400, 1300, Math.PI * 1.08, Math.PI * 1.32, false, { seed, roughness: 2, stroke: "#7fa9bb", strokeWidth: 12 }));
}

const STYLES = {
  flat: {
    name: "现在：平涂",
    note: "干净的扁平矢量，像动画片",
    draw({ svg, id }, { happy }) {
      svg.insertAdjacentHTML("beforeend", `<g clip-path="url(#${id}-frame)">
        <rect x="0" y="0" width="1254" height="1254" fill="${C.sky}" />
        <circle cx="434" cy="850" r="556" fill="${C.planet}" />
        <path clip-path="url(#${id}-planet)" d="${BAND}" fill="${C.band}" />
        ${faceMarkup(happy)}</g>`);
    }
  },

  crayon: {
    name: "蜡笔",
    note: "边缘微微抖动，颜色里有蜡笔颗粒和留白，像孩子自己涂的",
    draw(ctx, { happy }) {
      const { svg, id, defs, rc } = ctx;
      addDefs(defs, `
        <filter id="${id}-wax" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves="2" seed="4" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="26" xChannelSelector="R" yChannelSelector="G" result="wobble" />
          <feTurbulence type="fractalNoise" baseFrequency="0.035 0.16" numOctaves="2" seed="11" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.4 0 0 0 -0.62" result="holes" />
          <feComposite in="wobble" in2="holes" operator="in" />
        </filter>
        <filter id="${id}-line" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="6" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="12" xChannelSelector="R" yChannelSelector="G" />
        </filter>`);
      const art = el("g", { filter: `url(#${id}-wax)` }, svg);
      const clip = el("g", { "clip-path": `url(#${id}-frame)` }, art);
      el("rect", { x: 0, y: 0, width: 1254, height: 1254, fill: C.sky }, clip);
      el("circle", { cx: 434, cy: 850, r: 556, fill: C.planet }, clip);
      // Crayon strokes over the fill, a shade deeper, so the colouring shows its direction.
      clip.appendChild(rc.circle(434, 850, 1112, { seed: 7, roughness: 2.6, stroke: C.planetDeep, strokeWidth: 16, fill: "#e2813d", fillStyle: "zigzag", fillWeight: 12, hachureGap: 26, hachureAngle: -32 }));
      const band = el("g", { "clip-path": `url(#${id}-planet)` }, clip);
      band.appendChild(rc.path(BAND, { seed: 3, roughness: 1.8, stroke: C.band, strokeWidth: 10, fill: C.band, fillStyle: "solid" }));
      band.appendChild(rc.path(BAND, { seed: 5, roughness: 2, stroke: "none", fill: "#3d6d64", fillStyle: "zigzag", fillWeight: 6, hachureGap: 34, hachureAngle: 20 }));
      clip.appendChild(rc.circle(627, 627, 1240, { seed: 9, roughness: 1.6, stroke: "#a9c7d4", strokeWidth: 14 }));
      el("g", { filter: `url(#${id}-line)` }, svg).innerHTML = faceMarkup(happy);
    }
  },

  pencil: {
    name: "彩铅线稿",
    note: "铅笔轮廓加斜线涂色，留很多纸白；参考 Pok Pok 的手绘、低刺激",
    draw({ svg, id, rc }, { happy }) {
      const clip = el("g", { "clip-path": `url(#${id}-frame)` }, svg);
      clip.appendChild(rc.circle(627, 627, 1254, { seed: 2, roughness: 1, stroke: "none", fill: "#bcd8e6", fillStyle: "hachure", fillWeight: 5, hachureGap: 26, hachureAngle: 60 }));
      clip.appendChild(rc.circle(434, 850, 1112, { seed: 4, roughness: 1.4, stroke: C.pencil, strokeWidth: 7, fill: "#f09a55", fillStyle: "hachure", fillWeight: 9, hachureGap: 17, hachureAngle: -40 }));
      const band = el("g", { "clip-path": `url(#${id}-planet)` }, clip);
      band.appendChild(rc.path(BAND, { seed: 6, roughness: 1.4, stroke: C.pencil, strokeWidth: 7, fill: C.band, fillStyle: "cross-hatch", fillWeight: 6, hachureGap: 14 }));
      svg.appendChild(rc.circle(627, 627, 1250, { seed: 8, roughness: 1.2, stroke: "#8fb3c4", strokeWidth: 6 }));
      const face = el("g", {}, svg);
      if (happy) {
        for (const d of ["M262 712 Q305 660 348 712", "M640 674 Q683 622 726 674"]) face.appendChild(rc.path(d, { seed: 10, roughness: .8, stroke: C.ink, strokeWidth: 22 }));
        for (const [x, y] of [[236, 790], [764, 752]]) face.appendChild(rc.ellipse(x, y, 104, 60, { seed: x, roughness: 1, stroke: "none", fill: C.cheek, fillStyle: "hachure", fillWeight: 6, hachureGap: 12 }));
      } else {
        for (const [x, y] of [[305, 700], [683, 662]]) face.appendChild(rc.ellipse(x, y, 94, 100, { seed: x, roughness: .9, stroke: C.ink, strokeWidth: 6, fill: C.ink, fillStyle: "solid" }));
      }
      face.appendChild(rc.path(happy ? BIG : SMILE, { seed: 12, roughness: .8, stroke: C.ink, strokeWidth: 20 }));
    }
  },

  watercolor: {
    name: "绘本水彩",
    note: "颜色晕开、深浅不匀、边缘柔和，像图画书",
    draw({ svg, id, defs }, { happy }) {
      addDefs(defs, `
        <filter id="${id}-wash" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="2" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="34" xChannelSelector="R" yChannelSelector="G" result="bleed" />
          <feGaussianBlur in="bleed" stdDeviation="6" result="soft" />
          <feTurbulence type="fractalNoise" baseFrequency="0.005" numOctaves="2" seed="8" result="pool" />
          <feColorMatrix in="pool" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.1 0 0 0 0.3" result="density" />
          <feComposite in="soft" in2="density" operator="in" result="washed" />
          <feMorphology in="soft" operator="erode" radius="9" result="inner" />
          <feComposite in="soft" in2="inner" operator="out" result="rim" />
          <feColorMatrix in="rim" type="matrix" values="0.82 0 0 0 0  0 0.82 0 0 0  0 0 0.82 0 0  0 0 0 0.75 0" result="edge" />
          <feMerge><feMergeNode in="washed" /><feMergeNode in="edge" /></feMerge>
        </filter>
        <filter id="${id}-ink" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="3" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="8" xChannelSelector="R" yChannelSelector="G" />
        </filter>`);
      svg.insertAdjacentHTML("beforeend", `
        <g filter="url(#${id}-wash)"><g clip-path="url(#${id}-frame)">
          <rect x="0" y="0" width="1254" height="1254" fill="#c7dfeb" />
        </g></g>
        <g filter="url(#${id}-wash)"><g clip-path="url(#${id}-frame)">
          <circle cx="434" cy="850" r="556" fill="#ef9450" />
        </g></g>
        <g filter="url(#${id}-wash)"><g clip-path="url(#${id}-frame)"><path clip-path="url(#${id}-planet)" d="${BAND}" fill="#2f5e55" /></g></g>
        <g filter="url(#${id}-ink)">${faceMarkup(happy)}</g>`);
    }
  },

  collage: {
    name: "剪纸拼贴",
    note: "彩纸剪下来贴上去，有纸纹和投影；参考 Eric Carle 的拼贴绘本",
    draw({ svg, id, defs }, { happy }) {
      const paper = (name, seed) => `
        <filter id="${id}-${name}" x="-10%" y="-10%" width="125%" height="125%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="4" seed="${seed}" result="noise" />
          <feColorMatrix in="noise" type="saturate" values="0" result="grey" />
          <feComponentTransfer in="grey" result="fibre"><feFuncR type="linear" slope=".45" intercept=".68" /><feFuncG type="linear" slope=".45" intercept=".68" /><feFuncB type="linear" slope=".45" intercept=".68" /></feComponentTransfer>
          <feBlend in="SourceGraphic" in2="fibre" mode="multiply" result="textured" />
          <feComposite in="textured" in2="SourceAlpha" operator="in" result="cut" />
          <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="2" seed="${seed + 5}" result="warp" />
          <feDisplacementMap in="cut" in2="warp" scale="18" xChannelSelector="R" yChannelSelector="G" result="torn" />
          <feDropShadow in="torn" dx="10" dy="14" stdDeviation="7" flood-color="#173f3b" flood-opacity=".22" />
        </filter>`;
      addDefs(defs, paper("sky", 1) + paper("planet", 3) + paper("band", 6) + paper("face", 9));
      svg.insertAdjacentHTML("beforeend", `
        <g filter="url(#${id}-sky)"><circle cx="627" cy="627" r="627" fill="#cfe4ee" /></g>
        <g filter="url(#${id}-planet)"><g clip-path="url(#${id}-frame)"><circle cx="434" cy="850" r="556" fill="#f39c55" /></g></g>
        <g filter="url(#${id}-band)"><g clip-path="url(#${id}-frame)"><path clip-path="url(#${id}-planet)" d="${BAND}" fill="#2c5a52" /></g></g>
        <g filter="url(#${id}-face)">${faceMarkup(happy)}</g>`);
    }
  }
};

function draw(style, options, className) {
  const ctx = canvas(className);
  STYLES[style].draw(ctx, options);
  if (options.doodles && style !== "flat") doodles(ctx, 21);
  return ctx.svg;
}

function render() {
  const withDoodles = document.querySelector("#doodles").checked;
  const grid = document.querySelector("#grid");
  grid.replaceChildren();
  for (const [key, style] of Object.entries(STYLES)) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.style = key;
    card.innerHTML = `<h2>${style.name}</h2><p>${style.note}</p><div class="stage"></div><div class="sizes"></div>`;
    const stage = card.querySelector(".stage");
    stage.append(draw(key, { happy: false, doodles: withDoodles }), draw(key, { happy: true, doodles: withDoodles }));
    const sizes = card.querySelector(".sizes");
    for (const size of ["s96", "s56", "s36"]) sizes.append(draw(key, { happy: false, doodles: false }, size));
    grid.append(card);
  }
}

document.querySelector("#doodles").addEventListener("change", render);
render();
