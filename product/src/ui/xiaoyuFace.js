// Xiaoyu (A1) redrawn as SVG from assets/xiaoyu-planet.png, so the face can change with what she is
// doing: idle, listening, thinking, speaking, happy. Shapes and colours follow the PNG (measured).
// Other looks were tried on 2026-11-03 (a ringed planet, a potato asteroid) and the user went back to A1.
let uid = 0;
export function xiaoyuSvg(className = "") {
  const id = `xy${uid++}`;
  return `<svg class="xy ${className}" viewBox="0 0 1254 1254" data-face="idle" aria-hidden="true" focusable="false">
  <defs>
    <clipPath id="${id}-frame"><circle cx="627" cy="627" r="627" /></clipPath>
    <clipPath id="${id}-planet"><circle cx="434" cy="850" r="556" /></clipPath>
  </defs>
  <g clip-path="url(#${id}-frame)">
    <rect width="1254" height="1254" fill="#d5e7f0" />
    <g class="xy-body">
      <circle cx="434" cy="850" r="556" fill="#f2a061" />
      <path clip-path="url(#${id}-planet)" fill="#27534c" d="M-20 1057 C 380 1032 790 962 1000 735 L 1010 945 C 860 1082 480 1192 -20 1198 Z" />
      <g class="xy-cheeks" fill="#ee8760"><ellipse cx="236" cy="790" rx="52" ry="30" /><ellipse cx="764" cy="752" rx="52" ry="30" /></g>
      <g class="xy-eyes" fill="#27534c" stroke="#27534c" stroke-width="26" stroke-linecap="round">
        <g class="xy-eyes-open" stroke="none"><ellipse class="xy-eye" cx="305" cy="700" rx="47" ry="50" /><ellipse class="xy-eye" cx="683" cy="662" rx="47" ry="50" /></g>
        <g class="xy-eyes-happy" fill="none"><path d="M262 712 Q305 660 348 712" /><path d="M640 674 Q683 622 726 674" /></g>
      </g>
      <g class="xy-mouth" fill="none" stroke="#27534c" stroke-width="22" stroke-linecap="round">
        <path class="xy-mouth-smile" d="M451 725 Q497 788 548 717" />
        <path class="xy-mouth-big" d="M440 718 Q497 810 562 706" />
        <path class="xy-mouth-hmm" d="M462 738 L530 728" />
        <ellipse class="xy-mouth-o" cx="498" cy="738" rx="22" ry="24" fill="#27534c" stroke="none" />
        <ellipse class="xy-mouth-talk" cx="498" cy="740" rx="44" ry="34" fill="#27534c" stroke="none" />
      </g>
    </g>
  </g>
</svg>`;
}
