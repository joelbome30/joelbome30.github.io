import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const qs = (selector, scope = document) => scope.querySelector(selector);
const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a, b, amount) => a + (b - a) * amount;
const smoothstep = (value) => value * value * (3 - 2 * value);

const body = document.body;
const canvas = qs("#webgl");
const boot = qs("#boot");
const bootProgress = qs("#boot-progress");
const bootLine = qs("#boot-line");
const bootStatus = qs("#boot-status");
const progressLine = qs("#page-progress");
const motionToggle = qs("#motion-toggle");
const motionLabel = qs("#hud-mode");
const cursor = qs(".cursor");

const pointer = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
  screenX: -100,
  screenY: -100,
  currentScreenX: -100,
  currentScreenY: -100,
  pressed: 0,
  targetPressed: 0,
};

const viewport = {
  width: window.innerWidth,
  height: window.innerHeight,
  mobile: window.innerWidth < 780,
};

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let motionReduced = prefersReducedMotion.matches;
let pageDepth = 0;
let activeScene = 0;
let paused = false;
let webglAvailable = true;
let bootFinished = false;

const updateBoot = (value, label = "CARGANDO GEOMETRÍA") => {
  const normalized = clamp(value);
  bootProgress.textContent = String(Math.round(normalized * 100)).padStart(3, "0");
  bootLine.style.width = `${normalized * 100}%`;
  bootStatus.textContent = label;
};

const finishBoot = (fallback = false) => {
  if (bootFinished) return;
  bootFinished = true;
  updateBoot(1, fallback ? "MODO COMPATIBLE" : "MUNDO LISTO");
  window.setTimeout(() => {
    boot.classList.add("is-complete");
    body.classList.remove("is-loading");
    body.classList.add("is-ready");
    if (!fallback) body.classList.add("webgl-ready");
  }, 420);
};

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.style.setProperty("--reveal-delay", entry.target.dataset.delay || "0");
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.14, rootMargin: "0px 0px -6%" },
);

qsa(".reveal").forEach((element, index) => {
  if (!element.dataset.delay) element.style.setProperty("--reveal-delay", String(index % 4));
  revealObserver.observe(element);
});

const videoObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const video = entry.target;
      if (entry.isIntersecting && !motionReduced) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  },
  { threshold: 0.38 },
);

qsa("video").forEach((video) => {
  video.muted = true;
  videoObserver.observe(video);
});

const sceneElements = qsa(".scene[data-scene]");
const sceneLinks = qsa("[data-scene-link]");

const sceneStates = [
  { position: [1.05, -0.15, 0], rotation: [0.12, 0.2, -0.08], scale: 1.0, distortion: 0.32, palette: 0.05, bloom: 0.82 },
  { position: [-2.55, 0.05, -0.7], rotation: [0.6, 1.8, 0.25], scale: 0.76, distortion: 0.62, palette: 0.16, bloom: 0.92 },
  { position: [2.7, 0.12, -1.0], rotation: [-0.2, 3.6, -0.15], scale: 0.68, distortion: 0.42, palette: 0.38, bloom: 0.76 },
  { position: [-3.1, -0.15, -1.15], rotation: [0.35, 5.1, 0.35], scale: 0.62, distortion: 0.84, palette: 0.76, bloom: 0.72 },
  { position: [3.1, 0.1, -0.85], rotation: [-0.45, 7.2, -0.22], scale: 0.7, distortion: 0.54, palette: 0.44, bloom: 1.0 },
  { position: [0, 0.05, -0.25], rotation: [0.3, 9.1, 0], scale: 1.2, distortion: 1.05, palette: 1.0, bloom: 1.22 },
];

let sceneKeyframes = [];

const calculateSceneKeyframes = () => {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  sceneKeyframes = sceneElements.map((element) => ({
    progress: clamp(element.offsetTop / maxScroll),
    scene: Number(element.dataset.scene),
    element,
  }));
  if (sceneKeyframes.length) {
    sceneKeyframes[sceneKeyframes.length - 1].progress = 1;
  }
};

const getWorldState = (progress) => {
  if (!sceneKeyframes.length) return { ...sceneStates[0], scene: 0 };
  let fromFrame = sceneKeyframes[0];
  let toFrame = sceneKeyframes[sceneKeyframes.length - 1];

  for (let index = 0; index < sceneKeyframes.length - 1; index += 1) {
    if (progress >= sceneKeyframes[index].progress && progress <= sceneKeyframes[index + 1].progress) {
      fromFrame = sceneKeyframes[index];
      toFrame = sceneKeyframes[index + 1];
      break;
    }
  }

  const range = Math.max(0.0001, toFrame.progress - fromFrame.progress);
  const localProgress = smoothstep(clamp((progress - fromFrame.progress) / range));
  const from = sceneStates[fromFrame.scene] || sceneStates[0];
  const to = sceneStates[toFrame.scene] || from;
  const mixArray = (a, b) => a.map((value, index) => lerp(value, b[index], localProgress));

  return {
    position: mixArray(from.position, to.position),
    rotation: mixArray(from.rotation, to.rotation),
    scale: lerp(from.scale, to.scale, localProgress),
    distortion: lerp(from.distortion, to.distortion, localProgress),
    palette: lerp(from.palette, to.palette, localProgress),
    bloom: lerp(from.bloom, to.bloom, localProgress),
    scene: localProgress > 0.52 ? toFrame.scene : fromFrame.scene,
  };
};

const updatePageState = () => {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  pageDepth = clamp(window.scrollY / maxScroll);
  progressLine.style.height = `${pageDepth * 100}%`;
  qs("#telemetry-scroll").textContent = `DEPTH ${String(Math.round(pageDepth * 999)).padStart(3, "0")}`;
};

window.addEventListener("scroll", updatePageState, { passive: true });
updatePageState();

const setActiveScene = (scene) => {
  if (activeScene === scene) return;
  activeScene = scene;
  sceneLinks.forEach((link) => {
    const isActive = Number(link.dataset.sceneLink) === activeScene;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
};

sceneLinks[0]?.classList.add("is-active");

const setMotionMode = (reduced) => {
  motionReduced = reduced;
  body.classList.toggle("motion-reduced", reduced);
  motionToggle.setAttribute("aria-pressed", String(reduced));
  motionLabel.textContent = reduced ? "ECO" : "ONLINE";
  qsa("video").forEach((video) => {
    if (reduced) video.pause();
  });
};

motionToggle.addEventListener("click", () => setMotionMode(!motionReduced));
prefersReducedMotion.addEventListener?.("change", (event) => setMotionMode(event.matches));
setMotionMode(motionReduced);

window.addEventListener(
  "pointermove",
  (event) => {
    pointer.targetX = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.targetY = -((event.clientY / window.innerHeight) * 2 - 1);
    pointer.screenX = event.clientX;
    pointer.screenY = event.clientY;
    qs("#telemetry-x").textContent = `X ${String(Math.round(event.clientX)).padStart(3, "0")}`;
    qs("#telemetry-y").textContent = `Y ${String(Math.round(event.clientY)).padStart(3, "0")}`;
  },
  { passive: true },
);

window.addEventListener("pointerdown", () => {
  pointer.targetPressed = 1;
  cursor.classList.add("is-pressed");
});

window.addEventListener("pointerup", () => {
  pointer.targetPressed = 0;
  cursor.classList.remove("is-pressed");
});

qsa("a, button, .system-card").forEach((element) => {
  element.addEventListener("pointerenter", () => cursor.classList.add("is-active"));
  element.addEventListener("pointerleave", () => cursor.classList.remove("is-active"));
});

qsa(".magnetic").forEach((element) => {
  element.addEventListener("pointermove", (event) => {
    if (motionReduced || viewport.mobile) return;
    const bounds = element.getBoundingClientRect();
    const x = event.clientX - (bounds.left + bounds.width / 2);
    const y = event.clientY - (bounds.top + bounds.height / 2);
    element.style.transform = `translate3d(${x * 0.12}px, ${y * 0.12}px, 0)`;
  });
  element.addEventListener("pointerleave", () => {
    element.style.transform = "translate3d(0, 0, 0)";
  });
});

document.addEventListener("visibilitychange", () => {
  paused = document.hidden;
  qsa("video").forEach((video) => {
    if (paused) video.pause();
  });
});

let renderer;
let scene;
let camera;
let composer;
let bloomPass;
let world;
let liquidMaterial;
let particles;
let orbitGroup;
let fallbackMesh;
let clock;

const vertexShader = `
  uniform float uTime;
  uniform float uDistortion;
  uniform float uPress;
  uniform float uScroll;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vWave;

  void main() {
    vec3 p = position;
    float speed = uTime * 1.35;
    float waveA = sin(p.y * 4.8 + speed + p.x * 1.7);
    float waveB = cos(p.x * 5.6 - speed * 0.86 + p.z * 2.3);
    float waveC = sin((p.z + p.y) * 6.2 + speed * 1.4 + uScroll * 5.0);
    float combined = (waveA + waveB * 0.72 + waveC * 0.45) / 2.17;
    float pressure = 1.0 + uPress * 2.4;
    p += normal * combined * 0.11 * uDistortion * pressure;
    p.x += sin(p.y * 2.2 + speed * 0.4) * 0.035 * uDistortion;
    p.z += cos(p.x * 2.4 - speed * 0.35) * 0.035 * uDistortion;

    vec4 worldPosition = modelMatrix * vec4(p, 1.0);
    vWorldPosition = worldPosition.xyz;
    vNormal = normalize(normalMatrix * normal);
    vWave = combined;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uPalette;
  uniform float uPress;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vWave;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDirection), 0.0), 2.5);
    float scan = sin(vWorldPosition.y * 15.0 - uTime * 2.4) * 0.5 + 0.5;
    float pulse = sin(uTime * 1.6 + vWorldPosition.x * 2.0) * 0.5 + 0.5;

    vec3 cyan = vec3(0.25, 0.92, 1.0);
    vec3 ice = vec3(0.76, 0.98, 1.0);
    vec3 violet = vec3(0.42, 0.25, 1.0);
    vec3 signal = vec3(1.0, 0.16, 0.025);
    vec3 dark = vec3(0.008, 0.025, 0.04);

    vec3 cool = mix(dark, mix(cyan, violet, pulse), 0.52 + fresnel * 0.48);
    vec3 hot = mix(signal, ice, fresnel * 0.72 + scan * 0.12);
    vec3 color = mix(cool, hot, smoothstep(0.45, 1.0, uPalette));
    color += cyan * fresnel * (0.8 + uPress * 0.9);
    color += ice * max(vWave, 0.0) * 0.12;
    color += scan * 0.025;

    float alpha = 0.78 + fresnel * 0.22;
    gl_FragColor = vec4(color, alpha);
  }
`;

const createLiquidMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDistortion: { value: 0.35 },
      uPress: { value: 0 },
      uScroll: { value: 0 },
      uPalette: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

const createParticles = () => {
  const count = viewport.mobile ? 420 : 1350;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const cyan = new THREE.Color(0x8ff3ff);
  const violet = new THREE.Color(0x826dff);

  for (let index = 0; index < count; index += 1) {
    const stride = index * 3;
    const radius = 4 + Math.random() * 13;
    const angle = Math.random() * Math.PI * 2;
    positions[stride] = Math.cos(angle) * radius + (Math.random() - 0.5) * 4;
    positions[stride + 1] = (Math.random() - 0.5) * 11;
    positions[stride + 2] = Math.sin(angle) * radius - Math.random() * 10;

    const color = cyan.clone().lerp(violet, Math.random());
    colors[stride] = color.r;
    colors[stride + 1] = color.g;
    colors[stride + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: viewport.mobile ? 0.026 : 0.02,
    vertexColors: true,
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
};

const createOrbitGroup = () => {
  const group = new THREE.Group();
  const colors = [0x8ff3ff, 0x826dff, 0xff5a16];
  colors.forEach((color, index) => {
    const geometry = new THREE.TorusGeometry(2.15 + index * 0.34, 0.008 + index * 0.002, 8, 144);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.18 - index * 0.03,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.set(index * 0.55, index * 0.72, index * 0.36);
    group.add(ring);
  });
  return group;
};

const normalizeModel = (model) => {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  const targetSize = 3.9;
  model.position.sub(center);
  model.scale.setScalar(targetSize / maxDimension);
};

const createFallbackGeometry = () => {
  const geometry = new THREE.TorusKnotGeometry(1.25, 0.35, viewport.mobile ? 110 : 190, viewport.mobile ? 20 : 32, 2, 5);
  fallbackMesh = new THREE.Mesh(geometry, liquidMaterial);
  world.add(fallbackMesh);
};

const setupThree = () => {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: !viewport.mobile,
      powerPreference: "high-performance",
    });
  } catch (error) {
    console.warn("WebGL no está disponible; se usará el modo visual compatible.", error);
    webglAvailable = false;
    finishBoot(true);
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, viewport.mobile ? 1.15 : 1.5));
  renderer.setSize(viewport.width, viewport.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x050608, 0);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050608, 0.038);
  camera = new THREE.PerspectiveCamera(viewport.mobile ? 46 : 38, viewport.width / viewport.height, 0.1, 100);
  camera.position.set(0, 0, 9.2);

  clock = new THREE.Clock();
  world = new THREE.Group();
  liquidMaterial = createLiquidMaterial();
  particles = createParticles();
  orbitGroup = createOrbitGroup();
  world.add(orbitGroup);
  scene.add(world, particles);

  const grid = new THREE.GridHelper(46, 46, 0x25616c, 0x102329);
  grid.position.y = -3.25;
  grid.position.z = -4;
  grid.material.transparent = true;
  grid.material.opacity = 0.19;
  scene.add(grid);

  const haloGeometry = new THREE.IcosahedronGeometry(2.55, 2);
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0x8ff3ff,
    wireframe: true,
    transparent: true,
    opacity: 0.035,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  orbitGroup.add(halo);

  createFallbackGeometry();

  if (!viewport.mobile && !motionReduced) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(viewport.width, viewport.height), 0.82, 0.55, 0.72);
    composer.addPass(bloomPass);
  }

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => updateBoot(0.12 + (loaded / Math.max(total, 1)) * 0.78);
  manager.onLoad = () => finishBoot(false);
  manager.onError = () => {
    bootStatus.textContent = "GEOMETRÍA DE RESERVA ACTIVADA";
  };

  const loader = new GLTFLoader(manager);
  loader.load(
    "/untitled.gltf",
    (gltf) => {
      const model = gltf.scene;
      normalizeModel(model);
      model.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry.computeVertexNormals();
        child.material = liquidMaterial;
        child.frustumCulled = false;
      });
      if (fallbackMesh) {
        fallbackMesh.geometry.dispose();
        world.remove(fallbackMesh);
        fallbackMesh = null;
      }
      world.add(model);
    },
    (event) => {
      if (!event.total) return;
      updateBoot(0.12 + (event.loaded / event.total) * 0.78);
    },
    (error) => {
      console.warn("El modelo principal no cargó; se mantiene la geometría de reserva.", error);
      finishBoot(false);
    },
  );

  window.setTimeout(() => finishBoot(false), 4200);
  animate();
};

const animateCursor = () => {
  pointer.currentScreenX = lerp(pointer.currentScreenX, pointer.screenX, 0.18);
  pointer.currentScreenY = lerp(pointer.currentScreenY, pointer.screenY, 0.18);
  cursor.style.transform = `translate3d(${pointer.currentScreenX - cursor.offsetWidth / 2}px, ${pointer.currentScreenY - cursor.offsetHeight / 2}px, 0)`;
};

const animate = () => {
  requestAnimationFrame(animate);
  animateCursor();
  if (!webglAvailable || paused) return;

  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  const state = getWorldState(pageDepth);
  setActiveScene(state.scene);

  const easing = motionReduced ? 1 : 1 - Math.pow(0.0008, delta);
  pointer.x = lerp(pointer.x, pointer.targetX, easing * 0.55);
  pointer.y = lerp(pointer.y, pointer.targetY, easing * 0.55);
  pointer.pressed = lerp(pointer.pressed, pointer.targetPressed, easing * 0.9);

  const mobileOffset = viewport.mobile ? 0.52 : 1;
  world.position.x = lerp(world.position.x, state.position[0] * mobileOffset + pointer.x * 0.22, easing);
  world.position.y = lerp(world.position.y, state.position[1] + pointer.y * 0.16, easing);
  world.position.z = lerp(world.position.z, state.position[2], easing);
  world.rotation.x = lerp(world.rotation.x, state.rotation[0] + pointer.y * 0.12, easing);
  world.rotation.y = lerp(world.rotation.y, state.rotation[1] + elapsed * (motionReduced ? 0.01 : 0.055) + pointer.x * 0.15, easing);
  world.rotation.z = lerp(world.rotation.z, state.rotation[2] - pointer.x * 0.06, easing);

  const responsiveScale = viewport.mobile ? state.scale * 0.72 : state.scale;
  const pressScale = 1 + pointer.pressed * 0.08;
  world.scale.setScalar(lerp(world.scale.x, responsiveScale * pressScale, easing));

  liquidMaterial.uniforms.uTime.value = elapsed;
  liquidMaterial.uniforms.uDistortion.value = lerp(
    liquidMaterial.uniforms.uDistortion.value,
    motionReduced ? 0.08 : state.distortion,
    easing,
  );
  liquidMaterial.uniforms.uPress.value = pointer.pressed;
  liquidMaterial.uniforms.uScroll.value = pageDepth;
  liquidMaterial.uniforms.uPalette.value = lerp(liquidMaterial.uniforms.uPalette.value, state.palette, easing);

  orbitGroup.rotation.x += delta * (motionReduced ? 0.01 : 0.09);
  orbitGroup.rotation.y -= delta * (motionReduced ? 0.01 : 0.12);
  particles.rotation.y = elapsed * 0.018 + pageDepth * 0.8;
  particles.rotation.x = Math.sin(elapsed * 0.09) * 0.05;

  camera.position.x = lerp(camera.position.x, pointer.x * 0.18, easing * 0.45);
  camera.position.y = lerp(camera.position.y, pointer.y * 0.12, easing * 0.45);
  camera.lookAt(0, 0, -0.5);

  if (bloomPass) bloomPass.strength = lerp(bloomPass.strength, state.bloom, easing);
  if (composer) composer.render();
  else renderer.render(scene, camera);
};

const handleResize = () => {
  viewport.width = window.innerWidth;
  viewport.height = window.innerHeight;
  viewport.mobile = window.innerWidth < 780;
  calculateSceneKeyframes();
  if (!webglAvailable || !renderer) return;
  camera.aspect = viewport.width / viewport.height;
  camera.fov = viewport.mobile ? 46 : 38;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, viewport.mobile ? 1.15 : 1.5));
  renderer.setSize(viewport.width, viewport.height, false);
  composer?.setSize(viewport.width, viewport.height);
};

window.addEventListener("resize", handleResize, { passive: true });
window.addEventListener("load", calculateSceneKeyframes, { once: true });
calculateSceneKeyframes();
setupThree();

