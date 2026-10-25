const { animate } = window.Motion;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const autoAnimations = new WeakMap();
let activeMeter;

drawCrayonFeedback();
drawPaperWash();
document.querySelectorAll(".listening-paper").forEach(startAutomaticPreview);
document.querySelectorAll(".listener-button").forEach(setupVoicePreview);

function drawCrayonFeedback() {
  const svg = document.querySelector(".crayon-feedback");
  if (!svg || !window.rough) return;
  const renderer = window.rough.svg(svg);
  const paths = [
    ["M 48 92 C 34 86, 28 79, 20 69", "#d87c45"],
    ["M 42 129 C 28 128, 21 128, 11 130", "#f2cb63"],
    ["M 49 165 C 34 171, 28 178, 19 187", "#74a8c7"],
    ["M 250 91 C 264 84, 270 78, 280 68", "#74a8c7"],
    ["M 256 129 C 270 128, 279 129, 289 131", "#d87c45"],
    ["M 250 166 C 266 172, 271 179, 281 188", "#7aa37b"]
  ];

  paths.forEach(([path, color], index) => {
    const node = renderer.path(path, {
      seed: 410 + index,
      stroke: color,
      strokeWidth: index % 2 ? 3 : 2.5,
      roughness: 1.35,
      bowing: 1.7
    });
    node.classList.add("crayon-line");
    svg.appendChild(node);
  });
}

function drawPaperWash() {
  const svg = document.querySelector(".paper-wash");
  if (!svg || !window.rough) return;
  const renderer = window.rough.svg(svg);
  const layers = [
    renderer.path("M 27 151 C 18 78, 80 27, 151 25 C 226 19, 286 71, 278 145 C 272 215, 216 258, 143 252 C 74 248, 34 217, 27 151 Z", {
      seed: 510,
      stroke: "#dbb870",
      strokeWidth: 1.2,
      fill: "#f5deb0",
      fillStyle: "solid",
      roughness: 1.65
    }),
    renderer.path("M 62 151 C 55 93, 102 53, 161 50 C 221 48, 257 91, 247 151 C 240 205, 202 229, 146 226 C 91 223, 66 198, 62 151 Z", {
      seed: 511,
      stroke: "#9dbba9",
      strokeWidth: 1,
      fill: "#deebdf",
      fillStyle: "solid",
      roughness: 1.5
    })
  ];
  layers.forEach((layer, index) => {
    layer.classList.add("wash-layer", `wash-layer-${index + 1}`);
    layer.setAttribute("opacity", index === 0 ? "0.7" : "0.62");
    svg.appendChild(layer);
  });
}

function startAutomaticPreview(paper) {
  if (reduceMotion || !animate) return;
  stopAutomaticPreview(paper);
  const character = paper.querySelector(".listener-character");
  const shadow = paper.querySelector(".soft-shadow");
  const lines = paper.querySelectorAll(".crayon-line");
  const wash = paper.querySelector(".paper-wash");
  const animations = [];

  if (paper.classList.contains("variant-breathe")) {
    animations.push(animate(character, { scale: [1, 1.055, 1], y: [0, -3, 0] }, {
      duration: 1.08,
      repeat: Infinity,
      ease: "easeInOut"
    }));
    animations.push(animate(shadow, { scaleX: [1, 1.16, 1], opacity: [0.62, 0.92, 0.62] }, {
      duration: 1.08,
      repeat: Infinity,
      ease: "easeInOut"
    }));
  }

  if (paper.classList.contains("variant-crayon")) {
    animations.push(animate(character, { scale: [1, 1.018, 1] }, {
      duration: 1.05,
      repeat: Infinity,
      ease: "easeInOut"
    }));
    lines.forEach((line, index) => {
      animations.push(animate(line, { opacity: [0.18, 0.9, 0.18], x: [0, index < 3 ? -3 : 3, 0] }, {
        duration: 1.05,
        delay: index * 0.035,
        repeat: Infinity,
        ease: "easeInOut"
      }));
    });
  }

  if (paper.classList.contains("variant-wash")) {
    animations.push(animate(character, { scale: [1, 1.018, 1] }, {
      duration: 1.3,
      repeat: Infinity,
      ease: "easeInOut"
    }));
    animations.push(animate(wash, { scale: [0.94, 1.04, 0.94], opacity: [0.78, 1, 0.78] }, {
      duration: 1.3,
      repeat: Infinity,
      ease: "easeInOut"
    }));
  }

  if (paper.classList.contains("variant-nod")) {
    animations.push(animate(character, {
      y: [0, -5, 0, -2, 0],
      rotate: [0, -1.4, 1.1, -0.5, 0],
      scaleY: [1, 0.987, 1, 0.994, 1]
    }, {
      duration: 1.34,
      repeat: Infinity,
      ease: "easeInOut"
    }));
    animations.push(animate(shadow, { scaleX: [1, 0.92, 1, 0.96, 1], opacity: [0.72, 0.5, 0.72] }, {
      duration: 1.34,
      repeat: Infinity,
      ease: "easeInOut"
    }));
  }

  autoAnimations.set(paper, animations);
}

function stopAutomaticPreview(paper) {
  (autoAnimations.get(paper) || []).forEach((animation) => animation.stop());
  autoAnimations.delete(paper);
}

function setupVoicePreview(button) {
  button.addEventListener("pointerdown", (event) => {
    const paper = button.closest(".listening-paper");
    button.setPointerCapture?.(event.pointerId);
    stopAutomaticPreview(paper);
    activeMeter?.stop();
    activeMeter = startVoiceMeter(paper);
  });

  const release = async () => {
    const paper = button.closest(".listening-paper");
    await activeMeter?.stop();
    activeMeter = undefined;
    resetPaper(paper);
    startAutomaticPreview(paper);
  };

  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
}

function startVoiceMeter(paper) {
  const character = paper.querySelector(".listener-character");
  const shadow = paper.querySelector(".soft-shadow");
  const lines = paper.querySelectorAll(".crayon-line");
  const wash = paper.querySelector(".paper-wash");
  let stream;
  let context;
  let frameId;
  let running = true;
  let smoothed = 0.01;

  const applyLevel = (level) => {
    const scale = 1 + Math.min(0.06, level * 0.84);
    character.style.transform = paper.classList.contains("variant-nod")
      ? `translateY(${-Math.min(5, level * 70)}px) rotate(${Math.sin(performance.now() / 130) * Math.min(1.8, level * 25)}deg)`
      : `scale(${scale})`;

    if (shadow) {
      shadow.style.transform = `translateX(-50%) scaleX(${1 + Math.min(0.14, level * 1.8)})`;
      shadow.style.opacity = String(0.6 + Math.min(0.28, level * 3));
    }
    lines.forEach((line, index) => {
      line.style.opacity = String(Math.min(1, 0.2 + level * 8 - index * 0.025));
    });
    if (wash) {
      wash.style.transform = `scale(${0.94 + Math.min(0.1, level * 1.3)})`;
      wash.style.opacity = String(0.76 + Math.min(0.24, level * 4));
    }
  };

  if (navigator.mediaDevices?.getUserMedia && !reduceMotion) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((nextStream) => {
      stream = nextStream;
      if (!running) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);

      const update = () => {
        if (!running) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const value = (sample - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / samples.length);
        smoothed += (rms - smoothed) * 0.22;
        applyLevel(smoothed);
        frameId = requestAnimationFrame(update);
      };
      update();
    }).catch(() => {
      if (running) startAutomaticPreview(paper);
    });
  }

  return {
    stop: async () => {
      running = false;
      if (frameId) cancelAnimationFrame(frameId);
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") await context.close();
    }
  };
}

function resetPaper(paper) {
  const character = paper.querySelector(".listener-character");
  const shadow = paper.querySelector(".soft-shadow");
  const wash = paper.querySelector(".paper-wash");
  character.style.transform = "";
  if (shadow) {
    shadow.style.transform = "translateX(-50%)";
    shadow.style.opacity = "";
  }
  paper.querySelectorAll(".crayon-line").forEach((line) => {
    line.style.opacity = "";
  });
  if (wash) {
    wash.style.transform = "";
    wash.style.opacity = "";
  }
}
