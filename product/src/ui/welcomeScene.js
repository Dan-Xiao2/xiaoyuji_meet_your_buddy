// The welcome illustration: Xiaoyu (A1, flat) floating over little hills, with the things children
// bring to her — a moon, a star, a question, a leaf, a snail and a flower. Flat shapes in the product's
// palette; each piece floats gently (styles in design-system.css; off with reduced motion). The hills run
// past the frame (overflow visible) and continue as the ground the brand and the start button sit on.
import { xiaoyuSvg } from "./xiaoyuFace.js";

export function welcomeSceneSvg() {
  const xiaoyu = xiaoyuSvg("ws-xiaoyu").replace("<svg ", '<svg x="112" y="96" width="176" height="176" ');
  return `<svg class="welcome-scene" viewBox="0 0 400 440" role="img" aria-label="小宇和孩子带来的发现：月亮、星星、问题、叶子、蜗牛和小花">
  <defs>
    <mask id="ws-moon-cut"><rect width="400" height="440" fill="white" /><circle cx="82" cy="66" r="20" fill="black" /></mask>
  </defs>
  <g class="ws-cloud" fill="#ffffff" opacity=".85">
    <path d="M40 -70 a22 22 0 0 1 40 -10 a26 26 0 0 1 48 8 a18 18 0 0 1 4 36 h-88 a18 18 0 0 1 -4 -34z" />
  </g>
  <g class="ws-cloud ws-cloud-slow" fill="#ffffff" opacity=".7">
    <path d="M262 -170 a18 18 0 0 1 33 -8 a22 22 0 0 1 40 6 a15 15 0 0 1 3 30 h-73 a15 15 0 0 1 -3 -28z" />
  </g>
  <g class="ws-float ws-f1"><circle cx="70" cy="74" r="22" fill="#fff1c9" mask="url(#ws-moon-cut)" /></g>
  <g class="ws-float ws-f2"><path d="M332 46 l7.6 15.4 17 2.5 -12.3 12 2.9 16.9 -15.2 -8 -15.2 8 2.9 -16.9 -12.3 -12 17 -2.5z" fill="#ffcf5c" stroke="#ffcf5c" stroke-width="5" stroke-linejoin="round" /></g>
  <g class="ws-float ws-f3">
    <path d="M300 150 a32 30 0 1 1 18 27 l-14 8 4 -14 a30 30 0 0 1 -8 -21z" fill="#ffffff" />
    <text x="332" y="164" text-anchor="middle" font-size="34" font-weight="800" fill="#f2a061" font-family="system-ui, -apple-system, sans-serif">?</text>
  </g>
  <g class="ws-float ws-f4" transform="rotate(-28 62 206)">
    <path d="M36 206 C 50 180 84 180 96 206 C 84 230 50 230 36 206 Z" fill="#7cc495" />
    <path d="M30 206 L 92 206" stroke="#4f9c6c" stroke-width="3" stroke-linecap="round" />
  </g>
  <ellipse cx="200" cy="300" rx="62" ry="9" fill="#27534c" opacity=".08" class="ws-shadow" />
  <g class="ws-float ws-hero">${xiaoyu}</g>
  <path d="M-700 360 C -400 330 -150 380 -10 368 C 70 330 150 336 214 360 C 280 384 340 352 410 334 C 600 300 800 360 1100 340 L 1100 441 L -700 441 Z" fill="#c4e3cf" />
  <path d="M-700 392 C -400 372 -200 410 -10 398 C 90 372 190 380 260 396 C 320 410 370 396 410 384 C 600 360 850 404 1100 386 L 1100 441 L -700 441 Z" fill="#a8d6b8" />
  <g class="ws-sway">
    <path d="M318 392 C 318 372 322 360 326 350" stroke="#4f9c6c" stroke-width="4" fill="none" stroke-linecap="round" />
    <path d="M320 376 C 306 370 302 360 304 354 C 314 356 320 364 320 376 Z" fill="#7cc495" />
    <g transform="translate(326 342)" fill="#f7aab9">
      <circle cx="0" cy="-11" r="8" /><circle cx="10.5" cy="-3.4" r="8" /><circle cx="6.5" cy="9" r="8" /><circle cx="-6.5" cy="9" r="8" /><circle cx="-10.5" cy="-3.4" r="8" />
      <circle cx="0" cy="0" r="6" fill="#ffcf5c" />
    </g>
  </g>
  <g class="ws-snail">
    <path d="M58 392 C 62 382 90 380 112 384 C 120 386 124 392 118 394 L 60 396 Z" fill="#e9c9a6" />
    <path d="M112 384 L 116 368 M 106 384 L 106 370" stroke="#c9a37e" stroke-width="3" stroke-linecap="round" />
    <circle cx="116" cy="366" r="3" fill="#27534c" /><circle cx="106" cy="368" r="3" fill="#27534c" />
    <circle cx="82" cy="374" r="17" fill="#f6c177" />
    <path d="M82 374 m -10 0 a 10 10 0 1 1 10 10 a 6 6 0 1 1 -6 -6 a 2.5 2.5 0 1 1 2.5 2.5" fill="none" stroke="#d9963f" stroke-width="3" stroke-linecap="round" />
  </g>
</svg>`;
}
