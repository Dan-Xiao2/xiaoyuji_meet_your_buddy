const { animate, stagger } = window.Motion;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

drawListeningOrbit();
drawStoryScene();
revealStoryScene();
setupListeningPreview();

function drawListeningOrbit() {
  const svg = document.querySelector(".listening-orbit");
  if (!svg || !window.rough) return;

  const renderer = window.rough.svg(svg);
  const orbit = renderer.path(
    "M 24 151 C 31 71, 96 23, 169 30 C 224 35, 249 79, 238 128 C 224 192, 159 233, 91 220",
    {
      seed: 307,
      stroke: "#6f8d83",
      strokeWidth: 2.2,
      roughness: 0.72,
      bowing: 0.7
    }
  );
  orbit.setAttribute("opacity", "0.55");
  svg.appendChild(orbit);
}

function drawStoryScene() {
  const svg = document.querySelector(".rough-scene");
  if (!svg || !window.rough) return;

  const renderer = window.rough.svg(svg);
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "rough-illustration");
  svg.appendChild(group);

  append(group, renderer.circle(72, 82, 84, {
    seed: 101,
    stroke: "#9c6f24",
    strokeWidth: 2.4,
    fill: "#f2cb63",
    fillStyle: "solid",
    roughness: 0.85
  }), "scene-part");

  [
    [72, 22, 72, 5],
    [31, 39, 18, 26],
    [113, 39, 127, 26]
  ].forEach(([x1, y1, x2, y2], index) => {
    append(group, renderer.line(x1, y1, x2, y2, {
      seed: 110 + index,
      stroke: "#d87c45",
      strokeWidth: 2.2,
      roughness: 0.8
    }), "scene-part");
  });

  append(group, renderer.path("M 111 104 C 138 111, 154 121, 179 137", {
    seed: 121,
    stroke: "#d87c45",
    strokeWidth: 3,
    roughness: 0.7,
    bowing: 1.1
  }), "scene-part");
  append(group, renderer.path("M 108 116 C 137 127, 151 139, 177 153", {
    seed: 122,
    stroke: "#e5a46f",
    strokeWidth: 2,
    roughness: 0.65
  }), "scene-part");

  append(group, renderer.ellipse(204, 157, 102, 76, {
    seed: 131,
    stroke: "#466d64",
    strokeWidth: 2.4,
    fill: "#e5eee7",
    fillStyle: "solid",
    roughness: 0.85
  }), "scene-part");

  append(group, renderer.path("M 232 177 C 254 184, 274 191, 300 204", {
    seed: 141,
    stroke: "#74a8c7",
    strokeWidth: 3.1,
    roughness: 0.8
  }), "scene-part");
  append(group, renderer.path("M 228 164 C 258 155, 277 145, 309 128", {
    seed: 142,
    stroke: "#74a8c7",
    strokeWidth: 2.5,
    roughness: 0.8
  }), "scene-part");
  append(group, renderer.path("M 223 187 C 246 211, 266 230, 294 253", {
    seed: 143,
    stroke: "#74a8c7",
    strokeWidth: 2.5,
    roughness: 0.8
  }), "scene-part");

  append(group, renderer.ellipse(282, 236, 106, 98, {
    seed: 151,
    stroke: "#5b91b2",
    strokeWidth: 2.4,
    fill: "#d7e8ed",
    fillStyle: "solid",
    roughness: 0.9
  }), "scene-part");

  addText(group, 72, 86, "阳光", "scene-label");
  addText(group, 204, 161, "空气", "scene-label");
  addText(group, 282, 240, "蓝色的小光", "scene-label scene-label-small");
}

function append(parent, node, className) {
  node.classList.add(className);
  parent.appendChild(node);
}

function addText(parent, x, y, label, className) {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", x);
  text.setAttribute("y", y);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("class", className);
  text.textContent = label;
  parent.appendChild(text);
}

function revealStoryScene() {
  if (reduceMotion || !animate) return;
  const parts = document.querySelectorAll(".rough-scene .scene-part, .rough-scene .scene-label");
  parts.forEach((part) => {
    part.style.opacity = "0";
  });
  animate(parts, { opacity: [0, 1], y: [7, 0] }, {
    duration: 0.34,
    delay: stagger(0.045),
    ease: [0.23, 1, 0.32, 1]
  });
}

function setupListeningPreview() {
  const button = document.querySelector(".is-listening .xiaoyu-button");
  const visual = button?.querySelector(".xiaoyu-visual");
  const moon = button?.querySelector(".orbit-moon");
  const orbit = button?.querySelector(".listening-orbit");
  const hint = document.querySelector("#audio-hint");
  if (!button || !visual || !moon || !orbit) return;

  let passiveAnimations = [];
  let stream;
  let audioContext;
  let frameId;
  let pressed = false;
  let smoothedScale = 1;

  const startPassiveMotion = () => {
    if (reduceMotion || !animate) return;
    passiveAnimations = [
      animate(visual, { scale: [1, 1.026, 1] }, {
        duration: 1.15,
        repeat: Infinity,
        ease: "easeInOut"
      }),
      animate(moon, { x: [0, 3, 0], y: [0, -2, 0] }, {
        duration: 1.15,
        repeat: Infinity,
        ease: "easeInOut"
      }),
      animate(orbit, { opacity: [0.7, 1, 0.7] }, {
        duration: 1.15,
        repeat: Infinity,
        ease: "easeInOut"
      })
    ];
  };

  const stopPassiveMotion = () => {
    passiveAnimations.forEach((animation) => animation.stop());
    passiveAnimations = [];
  };

  const stopMicrophone = async () => {
    pressed = false;
    if (frameId) cancelAnimationFrame(frameId);
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    if (audioContext && audioContext.state !== "closed") await audioContext.close();
    audioContext = undefined;
    visual.style.transform = "scale(1)";
    moon.style.transform = "translate(0, 0)";
    button.setAttribute("aria-pressed", "false");
    hint.textContent = "按住时，小宇会跟着声音轻轻呼吸";
    startPassiveMotion();
  };

  const startMicrophone = async (event) => {
    pressed = true;
    button.setPointerCapture?.(event.pointerId);
    button.setAttribute("aria-pressed", "true");
    stopPassiveMotion();
    animate?.(button, { scale: 0.97 }, { duration: 0.11, ease: [0.23, 1, 0.32, 1] });
    hint.textContent = "我在听，说完松开";

    if (!navigator.mediaDevices?.getUserMedia || reduceMotion) return;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!pressed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);

      const updateFromVoice = () => {
        if (!pressed) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const value = (sample - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / samples.length);
        const targetScale = 1 + Math.min(0.045, rms * 0.72);
        smoothedScale += (targetScale - smoothedScale) * 0.24;
        visual.style.transform = `scale(${smoothedScale.toFixed(4)})`;
        const offset = Math.min(4, rms * 52);
        moon.style.transform = `translate(${offset.toFixed(2)}px, ${(-offset * 0.6).toFixed(2)}px)`;
        frameId = requestAnimationFrame(updateFromVoice);
      };
      updateFromVoice();
    } catch {
      hint.textContent = "正在听，说完松开";
      startPassiveMotion();
    }
  };

  button.addEventListener("pointerdown", startMicrophone);
  button.addEventListener("pointerup", () => {
    animate?.(button, { scale: 1 }, { duration: 0.18, ease: [0.23, 1, 0.32, 1] });
    stopMicrophone();
  });
  button.addEventListener("pointercancel", stopMicrophone);
  button.addEventListener("lostpointercapture", () => {
    if (pressed) stopMicrophone();
  });

  startPassiveMotion();
}
