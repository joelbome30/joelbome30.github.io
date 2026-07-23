import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (a, b, amount) => a + (b - a) * amount;

const body = document.body;
const canvas = $("#universe");
const boot = $("#boot");
const cursor = $("#cursor");
const labels = $$(".world-label");
const spatialCopy = $(".copy--spatial");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const page = body.dataset.page || "home";
const isTouch = matchMedia("(pointer: coarse)").matches;

let reducedMotion = prefersReducedMotion.matches;
let renderer;
let scene;
let camera;
let composer;
let bloom;
let clock;
let pageHidden = false;
let hoveredRoot = null;
let labelHoveredRoot = null;
let pointerDown = null;
let entryProgress = reducedMotion ? 1 : 0;
let warpState = null;

const pointer = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
  clientX: innerWidth / 2,
  clientY: innerHeight / 2,
  cursorX: innerWidth / 2,
  cursorY: innerHeight / 2,
};

const anchors = new Map();
const interactiveMeshes = [];
const animatedNodes = [];
const organisms = [];
const portals = [];
const floatingSpores = [];
const returnBeacons = [];
const constellationStars = [];
const constellationGroups = [];
const sceneSystems = [];
const cosmicEffects = [];
const sceneTextMeshes = [];
let sceneTextGroup = null;
const tempVector = new THREE.Vector3();
const warpDestination = new THREE.Vector3();
const warpLookMatrix = new THREE.Matrix4();
const warpTargetQuaternion = new THREE.Quaternion();
const warpRollQuaternion = new THREE.Quaternion();
const warpRollAxis = new THREE.Vector3(0, 0, 1);
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const paletteValues = {
  background: 0x02030a,
  fog: 0x030510,
  star: 0xc8f6ff,
  cyan: 0x5ff8ff,
  blue: 0x4b7dff,
  violet: 0xa66cff,
  pink: 0xff62d3,
  acid: 0xb8ff68,
  deep: 0x080d24,
};

const palette = () => paletteValues;

body.dataset.theme = "dark";
if (!reducedMotion) body.classList.add("is-entering");

function finishBoot() {
  boot?.classList.add("is-finished");
}

function registerMaterial(material, role, darkOpacity, lightOpacity = darkOpacity) {
  material.userData.themeRole = role;
  material.userData.darkOpacity = darkOpacity;
  material.userData.lightOpacity = lightOpacity;
  material.userData.darkBlending = material.blending;
  return material;
}

function basicMaterial(role, options = {}) {
  const opacity = options.opacity ?? 1;
  return registerMaterial(
    new THREE.MeshBasicMaterial({
      color: palette()[role],
      transparent: options.transparent ?? opacity < 1,
      opacity,
      wireframe: options.wireframe ?? false,
      side: options.side ?? THREE.FrontSide,
      depthWrite: options.depthWrite ?? opacity >= 1,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }),
    role,
    opacity,
    options.lightOpacity ?? opacity,
  );
}

function lineMaterial(role, opacity = 0.45, lightOpacity = opacity) {
  return registerMaterial(
    new THREE.LineBasicMaterial({
      color: palette()[role],
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    role,
    opacity,
    lightOpacity,
  );
}

function wrapSceneText(context, text, maxWidth) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? line + " " + word : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function fitSceneHeading(context, lines, maxWidth) {
  let size = 230;
  while (size > 128) {
    context.font = "700 " + size + "px 'Space Grotesk', sans-serif";
    if (Math.max(...lines.map((line) => context.measureText(line).width)) <= maxWidth) break;
    size -= 4;
  }
  return size;
}

function drawTrackedText(context, text, x, y, tracking) {
  let cursorX = x;
  [...text].forEach((character) => {
    context.fillText(character, cursorX, y);
    cursorX += context.measureText(character).width + tracking;
  });
}

function createSceneTextCanvas(text, kind, accent = "#5ff8ff") {
  const canvasTexture = document.createElement("canvas");
  const context = canvasTexture.getContext("2d");
  canvasTexture.width = kind === "heading" ? 2048 : 1536;
  canvasTexture.height = kind === "eyebrow" ? 192 : kind === "heading" ? 640 : 576;
  context.clearRect(0, 0, canvasTexture.width, canvasTexture.height);
  context.textBaseline = "top";

  if (kind === "heading") {
    const lines = text.split("|").map((line) => line.trim()).filter(Boolean);
    const size = fitSceneHeading(context, lines, canvasTexture.width - 140);
    const lineHeight = size * 0.86;
    context.font = "700 " + size + "px 'Space Grotesk', sans-serif";
    context.lineJoin = "round";
    lines.forEach((line, index) => {
      const y = 64 + index * lineHeight;
      context.shadowBlur = 0;
      context.strokeStyle = "rgba(0, 1, 7, 0.98)";
      context.lineWidth = 18;
      context.strokeText(line, 70, y);
      context.shadowColor = accent;
      context.shadowBlur = index ? 8 : 5;
      context.fillStyle = "rgba(255, 255, 255, 1)";
      context.fillText(line, 70, y);
      if (index) {
        context.shadowBlur = 0;
        context.strokeStyle = accent;
        context.globalAlpha = 0.72;
        context.lineWidth = 2;
        context.strokeText(line, 70, y);
        context.globalAlpha = 1;
      }
    });
  } else if (kind === "eyebrow") {
    context.font = "600 47px 'DM Mono', monospace";
    context.lineJoin = "round";
    context.strokeStyle = "rgba(0, 1, 7, 0.98)";
    context.lineWidth = 8;
    [...text.toUpperCase()].reduce((cursorX, character) => {
      context.strokeText(character, cursorX, 62);
      return cursorX + context.measureText(character).width + 7;
    }, 36);
    context.fillStyle = "rgba(252, 254, 255, 1)";
    context.shadowColor = "rgba(0, 1, 7, 0.98)";
    context.shadowBlur = 8;
    drawTrackedText(context, text.toUpperCase(), 36, 62, 7);
    context.fillStyle = accent;
    context.fillRect(36, 128, 196, 3);
  } else {
    context.font = "600 60px 'Space Grotesk', sans-serif";
    const lines = wrapSceneText(context, text, canvasTexture.width - 210).slice(0, 6);
    context.lineJoin = "round";
    lines.forEach((line, index) => {
      const y = 74 + index * 78;
      context.shadowBlur = 0;
      context.strokeStyle = "rgba(0, 1, 7, 0.98)";
      context.lineWidth = 14;
      context.strokeText(line, 132, y);
      context.fillStyle = "rgba(255, 255, 255, 1)";
      context.fillText(line, 132, y);
    });
    context.shadowBlur = 0;
    context.strokeStyle = accent;
    context.globalAlpha = 0.64;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(78, 67);
    context.lineTo(78, Math.min(510, 112 + lines.length * 70));
    context.stroke();
    context.fillStyle = accent;
    context.beginPath();
    context.arc(78, 67, 8, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
  }

  return canvasTexture;
}

function createSceneTextPlane(parent, text, kind, options) {
  const source = createSceneTextCanvas(text, kind, options.accent);
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const height = options.width * (source.height / source.width);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: options.opacity ?? 1,
    alphaTest: 0.018,
    depthTest: false,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(options.width, height), material);
  mesh.renderOrder = 20;
  mesh.position.set(...options.position);
  mesh.rotation.set(...(options.rotation || [0, 0, 0]));
  mesh.userData.basePosition = mesh.position.clone();
  mesh.userData.baseRotation = mesh.rotation.clone();
  mesh.userData.phase = options.phase || 0;
  mesh.userData.drift = options.drift ?? 0.035;
  sceneTextMeshes.push(mesh);
  parent.add(mesh);
  return mesh;
}

function createSceneCopy() {
  if (!spatialCopy) return;
  const titleLines = spatialCopy.querySelector("h2")?.innerText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean) || [];
  const eyebrow = spatialCopy.querySelector(".eyebrow")?.textContent.trim() || "";
  const paragraph = spatialCopy.querySelector(":scope > p:last-child")?.textContent.trim() || "";
  const layouts = {
    skills: {
      accent: "#5ff8ff",
      eyebrow: { position: [-5.62, 4.12, 0.15], width: 4.9, rotation: [0.01, -0.04, -0.015], phase: 0.4 },
      heading: { position: [-5.15, 2.7, -0.48], width: 6.25, rotation: [-0.02, 0.065, -0.012], phase: 1.1 },
      body: { position: [-5.2, -2.42, -0.72], width: 4.55, rotation: [0.015, -0.045, 0.006], phase: 2.2 },
    },
    projects: {
      accent: "#ff62d3",
      eyebrow: { position: [-5.78, 4.18, 0.08], width: 4.65, rotation: [0, -0.04, -0.018], phase: 0.8 },
      body: { position: [-5.35, 2.35, -0.5], width: 4.18, rotation: [0.02, -0.085, -0.012], phase: 2.7 },
      heading: { position: [-5.18, -0.38, -0.82], width: 5.75, rotation: [-0.018, -0.095, 0.018], phase: 1.6 },
    },
    github: {
      accent: "#a66cff",
      eyebrow: { position: [-5.76, 4.18, 0.1], width: 4.7, rotation: [0, 0.045, -0.02], phase: 0.2 },
      heading: { position: [-5.2, 2.25, -0.66], width: 5.7, rotation: [-0.02, 0.085, -0.014], phase: 1.4 },
      body: { position: [-2.85, -3.3, -0.86], width: 4.25, rotation: [0.02, -0.12, 0.022], phase: 2.4 },
    },
  };
  const layout = layouts[page];
  if (!layout || !titleLines.length) return;

  sceneTextGroup = new THREE.Group();
  sceneTextGroup.userData.isSceneCopy = true;
  scene.add(sceneTextGroup);
  createSceneTextPlane(sceneTextGroup, eyebrow, "eyebrow", { ...layout.eyebrow, accent: layout.accent, opacity: 0.9, drift: 0.024 });
  createSceneTextPlane(sceneTextGroup, titleLines.join("|"), "heading", { ...layout.heading, accent: layout.accent, drift: 0.032 });
  createSceneTextPlane(sceneTextGroup, paragraph, "body", { ...layout.body, accent: layout.accent, opacity: 0.94, drift: 0.042 });
}

function createGlowTexture() {
  const size = 256;
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = size;
  glowCanvas.height = size;
  const context = glowCanvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.1, "rgba(255,255,255,.76)");
  gradient.addColorStop(0.35, "rgba(255,255,255,.2)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(glowCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const glowTexture = createGlowTexture();

function createGlow(role, size = 3, opacity = 0.38) {
  const material = registerMaterial(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: palette()[role],
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    role,
    opacity,
    opacity,
  );
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size, 1);
  return sprite;
}

const organismVertex = [
  "uniform float uTime;",
  "uniform float uAmplitude;",
  "varying vec3 vNormalView;",
  "varying vec3 vPosition;",
  "void main() {",
  "  vec3 p = position;",
  "  float wave = sin(p.x * 3.1 + uTime * 0.8) + sin(p.y * 3.8 - uTime * 0.62) + sin(p.z * 4.3 + uTime * 0.48);",
  "  p += normal * wave * uAmplitude;",
  "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
  "  vNormalView = normalize(normalMatrix * normal);",
  "  vPosition = p;",
  "  gl_Position = projectionMatrix * mv;",
  "}",
].join("\n");

const organismFragment = [
  "uniform float uTime;",
  "uniform vec3 uColorA;",
  "uniform vec3 uColorB;",
  "uniform float uOpacity;",
  "varying vec3 vNormalView;",
  "varying vec3 vPosition;",
  "void main() {",
  "  float fresnel = pow(1.0 - abs(vNormalView.z), 2.4);",
  "  float pulse = sin((vPosition.y + vPosition.x) * 7.0 - uTime * 1.5) * 0.5 + 0.5;",
  "  float cells = sin(vPosition.x * 14.0) * sin(vPosition.y * 13.0) * sin(vPosition.z * 12.0);",
  "  vec3 color = mix(uColorA, uColorB, pulse * 0.68 + 0.16);",
  "  color += uColorA * max(cells, 0.0) * 0.16;",
  "  float alpha = (0.12 + fresnel * 0.82 + pulse * 0.08) * uOpacity;",
  "  gl_FragColor = vec4(color, alpha);",
  "}",
].join("\n");

function organismMaterial(primary = "cyan", secondary = "violet", opacity = 1) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAmplitude: { value: 0.055 },
      uColorA: { value: new THREE.Color(palette()[primary]) },
      uColorB: { value: new THREE.Color(palette()[secondary]) },
      uOpacity: { value: opacity },
    },
    vertexShader: organismVertex,
    fragmentShader: organismFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.userData.primary = primary;
  material.userData.secondary = secondary;
  material.userData.darkOpacity = opacity;
  material.userData.lightOpacity = opacity * 0.7;
  return material;
}

function createOrganism(parent, position, scale = 1, options = {}) {
  const root = new THREE.Group();
  root.position.copy(position);
  root.scale.setScalar(scale);
  root.userData.baseScale = scale;
  root.userData.phase = Math.random() * Math.PI * 2;
  root.userData.hoverAmount = 0;

  const detail = innerWidth < 720 ? 3 : 4;
  const coreMaterial = organismMaterial(options.primary || "cyan", options.secondary || "violet", 1);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, detail), coreMaterial);
  root.add(core);

  const membrane = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.16, 2),
    basicMaterial(options.secondary || "violet", {
      wireframe: true,
      opacity: 0.14,
      lightOpacity: 0.08,
      depthWrite: false,
      additive: true,
    }),
  );
  membrane.rotation.set(0.25, 0.4, 0);
  root.add(membrane);

  const nucleus = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 24, 20),
    basicMaterial(options.nucleus || "pink", {
      opacity: 0.84,
      lightOpacity: 0.62,
      additive: true,
      depthWrite: false,
    }),
  );
  root.add(nucleus);

  const glow = createGlow(options.primary || "cyan", 3.9, 0.32);
  root.add(glow);

  const rings = [];
  for (let index = 0; index < 3; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.42 + index * 0.28, 0.012 + index * 0.003, 8, 140),
      basicMaterial(index === 1 ? "violet" : "cyan", {
        opacity: 0.32 - index * 0.055,
        lightOpacity: 0.16 - index * 0.025,
        additive: true,
        depthWrite: false,
      }),
    );
    ring.rotation.set(0.45 + index * 0.75, index * 0.54, 0.35 + index * 0.42);
    rings.push(ring);
    root.add(ring);
  }

  root.userData.core = core;
  root.userData.membrane = membrane;
  root.userData.nucleus = nucleus;
  root.userData.glow = glow;
  root.userData.rings = rings;
  organisms.push(root);
  parent.add(root);
  return root;
}

function makeOrganismInteractive(root, anchorName, action) {
  root.userData.anchorName = anchorName;
  root.userData.action = action;
  anchors.set(anchorName, root);
  const hitArea = new THREE.Mesh(
    new THREE.SphereGeometry(1.78, 20, 16),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  );
  hitArea.userData.hitRoot = root;
  root.add(hitArea);
  root.userData.hitArea = hitArea;

  [root.userData.core, root.userData.membrane, root.userData.nucleus, ...root.userData.rings, hitArea].forEach((mesh) => {
    mesh.userData.hitRoot = root;
    interactiveMeshes.push(mesh);
  });
  return root;
}

function createBranch(parent, start, end, role = "cyan", bend = 0.5) {
  const direction = end.clone().sub(start);
  const side = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
  const midpoint = start.clone().lerp(end, 0.5).add(side.multiplyScalar(bend));
  midpoint.z += 0.35;
  const curve = new THREE.CatmullRomCurve3([
    start.clone(),
    start.clone().lerp(midpoint, 0.45),
    midpoint,
    midpoint.clone().lerp(end, 0.58),
    end.clone(),
  ]);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 54, 0.018, 5, false),
    basicMaterial(role, {
      opacity: 0.48,
      lightOpacity: 0.24,
      additive: true,
      depthWrite: false,
    }),
  );
  parent.add(tube);

  const points = curve.getPoints(70);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const trace = new THREE.Line(geometry, lineMaterial(role, 0.22, 0.12));
  trace.scale.setScalar(1.012);
  parent.add(trace);
  return curve;
}

function createConstellation(parent, points, connections, options = {}) {
  const group = new THREE.Group();
  const defaultRole = options.role || "cyan";
  const segmentsByRole = new Map();

  connections.forEach(([from, to, role = defaultRole]) => {
    if (!segmentsByRole.has(role)) segmentsByRole.set(role, []);
    segmentsByRole.get(role).push(points[from].clone(), points[to].clone());
  });

  segmentsByRole.forEach((segments, role) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(segments);
    const glowLine = new THREE.LineSegments(geometry, lineMaterial(role, 0.16, 0.09));
    glowLine.scale.setScalar(1.008);
    group.add(glowLine);
    group.add(new THREE.LineSegments(geometry.clone(), lineMaterial(role, 0.62, 0.32)));
  });

  points.forEach((position, index) => {
    const role = options.pointRoles?.[index] || defaultRole;
    const major = options.major?.includes(index);
    const marker = new THREE.Group();
    const size = (options.starSize || 0.075) * (major ? 1.55 : 1);
    marker.position.copy(position);
    marker.userData.baseScale = major ? 1.18 : 1;
    marker.userData.phase = index * 0.73 + Math.random() * 0.5;
    marker.add(
      createGlow(role, size * (major ? 13 : 10), major ? 0.32 : 0.2),
      new THREE.Mesh(
        new THREE.OctahedronGeometry(size, 1),
        basicMaterial(role, { opacity: 0.96, lightOpacity: 0.7, additive: true, depthWrite: false }),
      ),
    );
    constellationStars.push(marker);
    group.add(marker);
  });

  if (options.anchorName) {
    const anchor = new THREE.Object3D();
    anchor.position.copy(options.anchorPosition || points[options.anchorIndex || 0]);
    anchors.set(options.anchorName, anchor);
    group.add(anchor);
  }

  group.userData.phase = Math.random() * Math.PI * 2;
  constellationGroups.push(group);
  parent.add(group);
  return group;
}

function createNode(parent, name, position, options = {}) {
  const role = options.role || "cyan";
  const interactive = Boolean(options.action);
  const root = new THREE.Group();
  root.position.copy(position);
  root.userData.anchorName = name;
  root.userData.action = options.action;
  root.userData.interactive = interactive;
  root.userData.desktopScale = options.scale || 1;
  root.userData.mobileScale = options.mobileScale || root.userData.desktopScale;
  root.userData.baseScale = root.userData.desktopScale;
  root.userData.baseZ = position.z;
  root.userData.phase = Math.random() * Math.PI * 2;
  root.scale.setScalar(root.userData.baseScale);

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.28, 2),
    organismMaterial(role, options.secondary || "violet", interactive ? 1 : 0.58),
  );
  const nucleus = new THREE.Mesh(
    new THREE.SphereGeometry(0.105, 18, 14),
    basicMaterial(options.secondary || "pink", {
      opacity: interactive ? 0.95 : 0.58,
      lightOpacity: interactive ? 0.72 : 0.46,
      additive: true,
      depthWrite: false,
    }),
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.48, 0.014, 7, 72),
    basicMaterial(role, {
      opacity: interactive ? 0.64 : 0.22,
      lightOpacity: interactive ? 0.36 : 0.18,
      additive: true,
      depthWrite: false,
    }),
  );
  ring.rotation.set(1.08, 0.2, 0.35);
  const glow = createGlow(role, interactive ? 1.55 : 1.25, interactive ? 0.42 : 0.16);
  root.add(glow, shell, nucleus, ring);

  if (interactive) {
    [shell, nucleus, ring].forEach((mesh) => {
      mesh.userData.hitRoot = root;
      interactiveMeshes.push(mesh);
    });
  }

  animatedNodes.push(root);
  anchors.set(name, root);
  parent.add(root);
  return root;
}

function addReturnBeacon(root, radius = 1.9) {
  const guide = new THREE.Group();
  const arcLength = Math.PI * 1.62;
  const arc = new THREE.Mesh(
    new THREE.TorusGeometry(radius, Math.max(0.012, radius * 0.012), 7, 96, arcLength),
    basicMaterial("acid", {
      opacity: 0.72,
      lightOpacity: 0.42,
      additive: true,
      depthWrite: false,
    }),
  );
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(0.045, radius * 0.055), Math.max(0.14, radius * 0.18), 9),
    basicMaterial("acid", {
      opacity: 0.92,
      lightOpacity: 0.62,
      additive: true,
      depthWrite: false,
    }),
  );
  arrow.position.set(Math.cos(arcLength) * radius, Math.sin(arcLength) * radius, 0.02);
  arrow.rotation.z = arcLength;
  guide.rotation.x = 0.48;
  guide.rotation.z = -0.28;
  guide.userData.root = root;
  guide.userData.phase = Math.random() * Math.PI * 2;
  guide.add(arc, arrow);
  root.add(guide);

  const hitArea = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.08, 14, 10),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  );
  hitArea.userData.hitRoot = root;
  root.add(hitArea);
  interactiveMeshes.push(hitArea);

  returnBeacons.push(guide);
  return guide;
}

function createStarField() {
  const count = innerWidth < 720 ? 2600 : 7200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const cyan = new THREE.Color(palette().cyan);
  const violet = new THREE.Color(palette().violet);

  for (let index = 0; index < count; index += 1) {
    const stride = index * 3;
    positions[stride] = (Math.random() - 0.5) * 54;
    positions[stride + 1] = 13 - Math.random() * 66;
    positions[stride + 2] = -4 - Math.random() * 45;
    const color = cyan.clone().lerp(violet, Math.random());
    const brightness = 0.45 + Math.random() * 0.55;
    colors[stride] = color.r * brightness;
    colors[stride + 1] = color.g * brightness;
    colors[stride + 2] = color.b * brightness;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: innerWidth < 720 ? 0.055 : 0.04,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.userData.starField = true;
  material.userData.darkBlending = THREE.AdditiveBlending;
  const stars = new THREE.Points(geometry, material);
  stars.userData.isStarField = true;
  scene.add(stars);
  return stars;
}

function createGalaxyCloud(centerY, x, scale, roleA, roleB) {
  const count = innerWidth < 720 ? 1300 : 3400;
  const arms = 5;
  const radius = 8.5;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const a = new THREE.Color(palette()[roleA]);
  const b = new THREE.Color(palette()[roleB]);

  for (let index = 0; index < count; index += 1) {
    const stride = index * 3;
    const distance = Math.pow(Math.random(), 0.58) * radius;
    const arm = ((index % arms) / arms) * Math.PI * 2;
    const spin = distance * 0.82;
    const scatter = Math.pow(Math.random(), 2.3) * (Math.random() < 0.5 ? -1 : 1);
    positions[stride] = Math.cos(arm + spin) * distance + scatter * (0.4 + distance * 0.05);
    positions[stride + 1] = (Math.random() - 0.5) * (0.45 + distance * 0.08);
    positions[stride + 2] = Math.sin(arm + spin) * distance + scatter * 0.5;
    const color = a.clone().lerp(b, distance / radius);
    colors[stride] = color.r;
    colors[stride + 1] = color.g;
    colors[stride + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: innerWidth < 720 ? 0.045 : 0.034,
    vertexColors: true,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.userData.galaxy = true;
  material.userData.darkBlending = THREE.AdditiveBlending;
  const cloud = new THREE.Points(geometry, material);
  cloud.position.set(x, centerY, -14);
  cloud.scale.setScalar(scale);
  cloud.rotation.set(1.18, 0.12, Math.random() * Math.PI);
  cloud.userData.spin = (Math.random() * 0.004 + 0.002) * (Math.random() > 0.5 ? 1 : -1);
  scene.add(cloud);
  return cloud;
}

function createNebulaVeils() {
  const group = new THREE.Group();
  group.position.z = -25;
  group.userData.effectType = "nebula";
  group.userData.phase = Math.random() * Math.PI * 2;

  [
    { role: "cyan", size: 25, opacity: 0.085, position: [-7.5, 3.8, 0] },
    { role: "violet", size: 31, opacity: 0.1, position: [7.2, -3.4, -2] },
    { role: "pink", size: 19, opacity: 0.06, position: [1.5, 6.2, -4] },
  ].forEach(({ role, size, opacity, position }) => {
    const veil = createGlow(role, size, opacity);
    veil.position.set(...position);
    group.add(veil);
  });

  cosmicEffects.push(group);
  scene.add(group);
}

function createCometField() {
  [
    { role: "cyan", count: 9, phase: 0 },
    { role: "pink", count: 6, phase: 17 },
  ].forEach(({ role, count, phase }) => {
    const positions = new Float32Array(count * 6);
    const comets = [];

    for (let index = 0; index < count; index += 1) {
      comets.push({
        x: (Math.random() - 0.5) * 38,
        y: (Math.random() - 0.5) * 15,
        z: -9 - Math.random() * 17,
        speed: 0.5 + Math.random() * 0.85,
        length: 0.35 + Math.random() * 0.85,
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const streaks = new THREE.LineSegments(geometry, lineMaterial(role, 0.34, 0.16));
    streaks.frustumCulled = false;
    streaks.userData.effectType = "comets";
    streaks.userData.comets = comets;
    streaks.userData.phase = phase;
    cosmicEffects.push(streaks);
    scene.add(streaks);
  });
}

function createJourneySpine() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(3.5, 3, -9),
    new THREE.Vector3(-2.5, -8, -10),
    new THREE.Vector3(2.8, -18, -9),
    new THREE.Vector3(-3.2, -29, -11),
    new THREE.Vector3(0, -42, -8),
  ]);
  const spine = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 180, 0.035, 7, false),
    basicMaterial("violet", {
      opacity: 0.22,
      lightOpacity: 0.1,
      additive: true,
      depthWrite: false,
    }),
  );
  scene.add(spine);

  for (let index = 0; index < 42; index += 1) {
    const point = curve.getPoint(index / 41);
    const spore = new THREE.Mesh(
      new THREE.SphereGeometry(0.035 + Math.random() * 0.055, 10, 8),
      basicMaterial(index % 3 === 0 ? "pink" : "cyan", {
        opacity: 0.58,
        lightOpacity: 0.29,
        additive: true,
        depthWrite: false,
      }),
    );
    spore.position.copy(point);
    spore.position.x += (Math.random() - 0.5) * 1.2;
    spore.position.z += (Math.random() - 0.5) * 1.0;
    spore.userData.baseY = spore.position.y;
    spore.userData.phase = Math.random() * Math.PI * 2;
    floatingSpores.push(spore);
    scene.add(spore);
  }
}

function createHeroSystem() {
  const group = new THREE.Group();
  group.userData.baseY = 0;
  group.userData.mobileY = -2.15;
  group.userData.desktopX = 1.25;
  group.userData.mobileX = -1.55;
  scene.add(group);
  sceneSystems.push(group);

  const corePosition = new THREE.Vector3(2.65, 0, 0);
  const core = createOrganism(group, corePosition, 1.48, { primary: "cyan", secondary: "violet" });
  core.userData.heroCore = true;

  const nodes = [
    {
      name: "menu-skills",
      position: new THREE.Vector3(1.2, 3.5, 0.2),
      action: "paginas/habilidades.html",
      role: "cyan",
    },
    {
      name: "menu-projects",
      position: new THREE.Vector3(6.1, -0.2, 0.15),
      action: "paginas/proyectos.html",
      role: "violet",
      secondary: "pink",
    },
    {
      name: "menu-github",
      position: new THREE.Vector3(1.8, -3.6, 0.4),
      action: "paginas/github.html",
      role: "pink",
      secondary: "cyan",
    },
  ];

  nodes.forEach((data, index) => {
    createBranch(group, corePosition, data.position, data.role, index === 1 ? -0.62 : 0.52);
    createNode(group, data.name, data.position, {
      action: data.action,
      role: data.role,
      secondary: data.secondary,
      scale: 2.55,
      mobileScale: 1.18,
    });
  });
}

function createSkillsSystem() {
  const group = new THREE.Group();
  group.userData.baseY = 0;
  group.userData.mobileY = -0.75;
  group.userData.desktopX = 2.2;
  group.userData.mobileX = -1.15;
  group.userData.mobileScale = 0.68;
  scene.add(group);
  sceneSystems.push(group);

  const center = new THREE.Vector3(2.0, 0.05, -0.2);
  const skillPositions = [
    new THREE.Vector3(-0.7, 2.75, 0.25),
    new THREE.Vector3(4.8, 2.45, -0.35),
    new THREE.Vector3(-0.2, -2.75, 0.1),
    new THREE.Vector3(5.1, -2.5, 0.1),
  ];
  const orionPoints = [
    skillPositions[0],
    skillPositions[1],
    skillPositions[2],
    skillPositions[3],
    new THREE.Vector3(0.95, 0.38, -0.48),
    center,
    new THREE.Vector3(3.05, -0.28, -0.44),
    new THREE.Vector3(2.0, 3.55, -0.62),
  ];
  createConstellation(group, orionPoints, [
    [0, 1, "cyan"], [0, 4, "cyan"], [4, 5, "violet"], [5, 6, "violet"],
    [6, 1, "blue"], [4, 2, "pink"], [6, 3, "acid"], [2, 3, "violet"], [7, 5, "cyan"],
  ], {
    role: "cyan",
    pointRoles: ["cyan", "blue", "pink", "acid", "cyan", "violet", "blue", "cyan"],
    major: [4, 5, 6, 7],
    starSize: 0.085,
    anchorName: "constellation-orion",
    anchorPosition: new THREE.Vector3(2.0, 3.72, -0.5),
  });

  const core = createOrganism(group, center, 1.02, { primary: "violet", secondary: "cyan", nucleus: "acid" });
  makeOrganismInteractive(core, "skills-core", "../index.html");
  addReturnBeacon(core, 1.52);

  const skills = [
    { name: "skill-web", position: skillPositions[0], role: "cyan" },
    { name: "skill-python", position: skillPositions[1], role: "blue" },
    { name: "skill-games", position: skillPositions[2], role: "pink" },
    { name: "skill-systems", position: skillPositions[3], role: "acid" },
  ];

  skills.forEach((skill, index) => {
    createNode(group, skill.name, skill.position, {
      role: skill.role,
      secondary: index % 2 ? "violet" : "cyan",
      scale: 2.45,
      mobileScale: 1.05,
    });
  });

  // Una hélice corta une el centro: parece ADN, pero también una ruta de aprendizaje.
  const helixA = [];
  const helixB = [];
  for (let index = 0; index < 34; index += 1) {
    const t = index / 33;
    const y = -2.15 + t * 4.3;
    const angle = t * Math.PI * 5;
    helixA.push(new THREE.Vector3(center.x + Math.cos(angle) * 0.36, y, -1.1 + Math.sin(angle) * 0.2));
    helixB.push(new THREE.Vector3(center.x + Math.cos(angle + Math.PI) * 0.36, y, -1.1 + Math.sin(angle + Math.PI) * 0.2));
  }
  group.add(
    new THREE.Line(new THREE.BufferGeometry().setFromPoints(helixA), lineMaterial("cyan", 0.44, 0.2)),
    new THREE.Line(new THREE.BufferGeometry().setFromPoints(helixB), lineMaterial("violet", 0.44, 0.2)),
  );
}

const portalVertex = [
  "varying vec2 vUv;",
  "void main() {",
  "  vUv = uv;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");

const portalFragment = [
  "uniform float uTime;",
  "uniform vec3 uColorA;",
  "uniform vec3 uColorB;",
  "uniform float uOpacity;",
  "varying vec2 vUv;",
  "void main() {",
  "  vec2 p = vUv - 0.5;",
  "  float radius = length(p);",
  "  float angle = atan(p.y, p.x);",
  "  float spiral = sin(angle * 7.0 - radius * 42.0 + uTime * 2.2) * 0.5 + 0.5;",
  "  float center = smoothstep(0.5, 0.02, radius);",
  "  float rim = smoothstep(0.49, 0.34, radius) * smoothstep(0.18, 0.43, radius);",
  "  vec3 color = mix(uColorA, uColorB, spiral);",
  "  float alpha = (center * 0.1 + spiral * rim * 0.62) * uOpacity;",
  "  gl_FragColor = vec4(color, alpha);",
  "}",
].join("\n");

function createPortal(parent, name, position, action, roles = ["cyan", "violet"], options = {}) {
  const root = new THREE.Group();
  root.position.copy(position);
  root.userData.anchorName = name;
  root.userData.action = action;
  root.userData.baseScale = 1;
  root.userData.phase = Math.random() * Math.PI * 2;
  root.userData.variant = options.variant || "spiral";
  root.userData.baseRotationZ = options.rotation || 0;

  const diskMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(palette()[roles[0]]) },
      uColorB: { value: new THREE.Color(palette()[roles[1]]) },
      uOpacity: { value: 1 },
    },
    vertexShader: portalVertex,
    fragmentShader: portalFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  diskMaterial.userData.primary = roles[0];
  diskMaterial.userData.secondary = roles[1];
  diskMaterial.userData.darkOpacity = 1;
  diskMaterial.userData.lightOpacity = 0.64;

  const disk = new THREE.Mesh(new THREE.CircleGeometry(1.42, 90), diskMaterial);
  if (root.userData.variant === "lenticular") {
    disk.scale.set(1.55, 0.48, 1);
  } else if (root.userData.variant === "helix") {
    disk.scale.set(0.64, 0.64, 1);
  }
  root.add(disk);

  for (let index = 0; index < 4; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.5 + index * 0.18, 0.025 - index * 0.003, 8, 120),
      basicMaterial(index % 2 ? roles[1] : roles[0], {
        opacity: 0.72 - index * 0.1,
        lightOpacity: 0.38 - index * 0.055,
        additive: true,
        depthWrite: false,
      }),
    );
    if (root.userData.variant === "lenticular") {
      ring.scale.set(1.5 - index * 0.06, 0.43 + index * 0.055, 1);
      ring.rotation.x = 0.12 + index * 0.045;
      ring.rotation.y = (index - 1.5) * 0.055;
      ring.rotation.z = index % 2 ? 0.055 : -0.045;
    } else if (root.userData.variant === "helix") {
      ring.scale.set(0.72 + index * 0.08, 1.08 - index * 0.07, 1);
      ring.rotation.x = 0.88 + index * 0.28;
      ring.rotation.y = 0.35 + index * 0.24;
      ring.rotation.z = index * 0.38;
    } else {
      ring.rotation.x = (index - 1.5) * 0.08;
      ring.rotation.y = (index - 1.5) * 0.09;
    }
    ring.userData.portalRing = index;
    ring.userData.hitRoot = root;
    interactiveMeshes.push(ring);
    root.add(ring);
  }

  if (root.userData.variant === "lenticular") {
    const lane = new THREE.Mesh(
      new THREE.BoxGeometry(4.35, 0.055, 0.055),
      basicMaterial(roles[0], { opacity: 0.88, lightOpacity: 0.54, additive: true, depthWrite: false }),
    );
    lane.userData.hitRoot = root;
    interactiveMeshes.push(lane);
    root.add(lane);

    [-1, 1].forEach((direction) => {
      const jetPoints = [
        new THREE.Vector3(0, direction * 0.15, -0.05),
        new THREE.Vector3(direction * 0.12, direction * 0.85, 0),
        new THREE.Vector3(direction * 0.28, direction * 1.55, 0.08),
      ];
      const jet = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(jetPoints), 24, 0.018, 5, false),
        basicMaterial(roles[1], { opacity: 0.52, lightOpacity: 0.3, additive: true, depthWrite: false }),
      );
      root.add(jet);
    });
  }

  if (root.userData.variant === "helix") {
    for (let arm = 0; arm < 3; arm += 1) {
      const armPoints = [];
      for (let index = 0; index < 72; index += 1) {
        const t = index / 71;
        const radius = 0.16 + t * 1.72;
        const angle = t * Math.PI * 4.6 + arm * (Math.PI * 2 / 3);
        armPoints.push(new THREE.Vector3(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius * 0.58,
          Math.sin(t * Math.PI * 3 + arm) * 0.3,
        ));
      }
      const armMesh = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(armPoints), 72, 0.025, 5, false),
        basicMaterial(arm % 2 ? roles[1] : roles[0], {
          opacity: 0.76,
          lightOpacity: 0.42,
          additive: true,
          depthWrite: false,
        }),
      );
      armMesh.userData.hitRoot = root;
      interactiveMeshes.push(armMesh);
      root.add(armMesh);
    }
  }

  disk.userData.hitRoot = root;
  interactiveMeshes.push(disk);
  const portalGlow = createGlow(roles[0], root.userData.variant === "lenticular" ? 6.2 : 4.7, 0.32);
  if (root.userData.variant === "lenticular") portalGlow.scale.set(6.2, 2.45, 1);
  root.add(portalGlow);
  anchors.set(name, root);
  portals.push(root);
  parent.add(root);
  return root;
}

function createProjectsSystem() {
  const group = new THREE.Group();
  group.userData.baseY = 0;
  group.userData.mobileY = -0.45;
  group.userData.desktopX = 2.2;
  group.userData.mobileX = -1.25;
  group.userData.mobileScale = 0.62;
  scene.add(group);
  sceneSystems.push(group);

  const left = new THREE.Vector3(0.05, 1.85, 0);
  const right = new THREE.Vector3(4.55, -0.72, -0.35);
  const seed = new THREE.Vector3(1.95, -3.35, -0.6);
  const geminiPoints = [
    left,
    new THREE.Vector3(-0.35, 0.45, -0.35),
    new THREE.Vector3(-1.4, -0.2, -0.5),
    new THREE.Vector3(0.15, -0.92, -0.45),
    new THREE.Vector3(-0.75, -2.75, -0.55),
    new THREE.Vector3(0.85, -2.65, -0.5),
    right,
    new THREE.Vector3(4.25, 0.05, -0.38),
    new THREE.Vector3(5.55, 0.72, -0.55),
    new THREE.Vector3(4.2, -1.65, -0.46),
    new THREE.Vector3(3.45, -3.15, -0.55),
    new THREE.Vector3(5.05, -3.0, -0.5),
    seed,
  ];
  createConstellation(group, geminiPoints, [
    [0, 1, "cyan"], [1, 2, "cyan"], [1, 3, "cyan"], [3, 4, "cyan"], [3, 5, "cyan"],
    [6, 7, "pink"], [7, 8, "pink"], [7, 9, "pink"], [9, 10, "pink"], [9, 11, "pink"],
    [1, 7, "violet"], [5, 12, "acid"], [12, 10, "acid"],
  ], {
    role: "violet",
    pointRoles: ["cyan", "cyan", "blue", "cyan", "blue", "cyan", "pink", "pink", "violet", "pink", "violet", "pink", "acid"],
    major: [0, 6, 12],
    starSize: 0.08,
    anchorName: "constellation-gemini",
    anchorPosition: new THREE.Vector3(3.15, 3.45, -0.55),
  });

  const gameMakerPortal = createPortal(
    group,
    "project-gamemaker",
    left,
    "https://github.com/joelbome30/JuegoGameMaker",
    ["cyan", "violet"],
    { variant: "lenticular", rotation: -0.28 },
  );
  const frivPortal = createPortal(
    group,
    "project-friv",
    right,
    "https://github.com/joelbome30/Juegos_Frivnt",
    ["pink", "violet"],
    { variant: "helix", rotation: 0.38 },
  );
  gameMakerPortal.userData.desktopScale = 1.18;
  gameMakerPortal.userData.mobileScale = 0.94;
  frivPortal.userData.desktopScale = 1.08;
  frivPortal.userData.mobileScale = 0.9;
  [gameMakerPortal, frivPortal].forEach((portal) => {
    portal.userData.baseScale = portal.userData.desktopScale;
    portal.scale.setScalar(portal.userData.baseScale);
  });

  const core = createOrganism(group, seed, 0.9, { primary: "acid", secondary: "cyan", nucleus: "pink" });
  makeOrganismInteractive(core, "projects-core", "../index.html");
  addReturnBeacon(core, 1.46);
}

function createGithubSystem() {
  const group = new THREE.Group();
  group.userData.baseY = 0;
  group.userData.mobileY = -0.55;
  group.userData.desktopX = 2.0;
  group.userData.mobileX = -1.15;
  group.userData.mobileScale = 0.68;
  scene.add(group);
  sceneSystems.push(group);

  const cassiopeiaPoints = [
    new THREE.Vector3(-0.8, 1.7, -0.45),
    new THREE.Vector3(0.7, -0.9, -0.2),
    new THREE.Vector3(2.2, 1.4, -0.55),
    new THREE.Vector3(3.8, -1.0, -0.28),
    new THREE.Vector3(5.4, 1.8, 0.15),
  ];
  createConstellation(group, cassiopeiaPoints, [
    [0, 1, "cyan"], [1, 2, "violet"], [2, 3, "pink"], [3, 4, "acid"],
  ], {
    role: "violet",
    pointRoles: ["cyan", "blue", "pink", "violet", "acid"],
    major: [0, 2, 4],
    starSize: 0.1,
    anchorName: "constellation-cassiopeia",
    anchorPosition: new THREE.Vector3(2.25, 3.05, -0.55),
  });

  [0, 1, 3].forEach((pointIndex, index) => {
    createNode(group, "cassiopeia-star-" + pointIndex, cassiopeiaPoints[pointIndex], {
      role: ["cyan", "blue", "violet"][index],
      secondary: ["violet", "cyan", "pink"][index],
      scale: index === 1 ? 1.24 : 1.38,
      mobileScale: 0.9,
    });
  });

  const center = cassiopeiaPoints[2];
  const core = createOrganism(group, center, 1.58, {
    primary: "violet",
    secondary: "pink",
    nucleus: "cyan",
  });
  makeOrganismInteractive(core, "github-profile", "https://github.com/joelbome30");

  const exitPosition = cassiopeiaPoints[4];
  const exit = createNode(group, "github-home", exitPosition, {
    action: "../index.html",
    role: "acid",
    secondary: "cyan",
    scale: 1.9,
    mobileScale: 1.08,
  });
  addReturnBeacon(exit, 0.67);
}

function updateResponsiveLayout() {
  const mobile = innerWidth < 720;
  sceneSystems.forEach((system) => {
    system.position.y = mobile ? system.userData.mobileY : system.userData.baseY;
    system.position.x = mobile ? system.userData.mobileX : system.userData.desktopX;
    system.scale.setScalar(mobile ? (system.userData.mobileScale || 1) : (system.userData.desktopScale || 1));
  });
  animatedNodes.forEach((node) => {
    node.userData.baseScale = mobile ? node.userData.mobileScale : node.userData.desktopScale;
  });
  portals.forEach((portal) => {
    if (!portal.userData.desktopScale) return;
    portal.userData.baseScale = mobile ? portal.userData.mobileScale : portal.userData.desktopScale;
  });
  if (sceneTextGroup) sceneTextGroup.visible = !mobile;
  body.classList.toggle("webgl-copy-ready", Boolean(sceneTextGroup && !mobile));
}

function activateAction(action, root = null) {
  if (!action || warpState) return;
  if (action.startsWith("#")) {
    $(action)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  } else if (/^https?:\/\//i.test(action)) {
    window.open(action, "_blank", "noopener,noreferrer");
  } else if (reducedMotion || !renderer || !root) {
    body.classList.add("is-leaving");
    window.setTimeout(() => {
      window.location.href = action;
    }, reducedMotion ? 0 : 520);
  } else {
    const targetPosition = root.getWorldPosition(new THREE.Vector3());
    warpState = {
      action,
      root,
      progress: 0,
      startPosition: camera.position.clone(),
      startQuaternion: camera.quaternion.clone(),
      targetPosition,
      startRootScale: root.scale.x,
    };
    body.classList.add("is-warping");
    hoveredRoot = root;
  }
}

function updateWorldLabels() {
  labels.forEach((label) => {
    const anchor = anchors.get(label.dataset.anchor);
    if (!anchor) {
      label.classList.remove("is-visible");
      return;
    }

    anchor.getWorldPosition(tempVector);
    tempVector.project(camera);
    const inView = tempVector.z > -1 && tempVector.z < 1 && Math.abs(tempVector.x) < 1.18 && Math.abs(tempVector.y) < 1.18;
    if (!inView) {
      label.classList.remove("is-visible");
      return;
    }

    const x = (tempVector.x * 0.5 + 0.5) * innerWidth;
    const y = (-tempVector.y * 0.5 + 0.5) * innerHeight;
    const scale = clamp(1.02 - Math.max(tempVector.z, 0) * 0.22, 0.78, 1.05);
    label.style.setProperty("--x", x.toFixed(2) + "px");
    label.style.setProperty("--y", y.toFixed(2) + "px");
    label.style.setProperty("--anchor-opacity", "1");
    label.style.setProperty("--label-scale", scale.toFixed(3));
    label.classList.add("is-visible");
    label.classList.toggle("is-hovered", hoveredRoot?.userData.anchorName === label.dataset.anchor);
  });
}

function updateRaycast() {
  if (!camera || isTouch) return;
  mouse.set(pointer.targetX, pointer.targetY);
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(interactiveMeshes, false)[0];
  const nextRoot = labelHoveredRoot || hit?.object.userData.hitRoot || null;
  if (nextRoot !== hoveredRoot) {
    hoveredRoot = nextRoot;
    cursor?.classList.toggle("is-active", Boolean(hoveredRoot));
  }
}

function createScene() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: innerWidth > 720,
    powerPreference: "high-performance",
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 720 ? 1.2 : 1.6));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(palette().background, 1);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(palette().fog, 0.026);
  camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 140);
  camera.position.set(0, 0, reducedMotion ? 12.5 : 19);
  clock = new THREE.Clock();

  createStarField();
  const galaxyColors = {
    home: ["cyan", "violet"],
    skills: ["violet", "cyan"],
    projects: ["pink", "violet"],
    github: ["violet", "pink"],
  }[page] || ["cyan", "violet"];
  createGalaxyCloud(-1, page === "projects" ? -2 : 2, 1.28, galaxyColors[0], galaxyColors[1]);
  createNebulaVeils();
  createCometField();
  createJourneySpine();
  const systemCreators = {
    home: createHeroSystem,
    skills: createSkillsSystem,
    projects: createProjectsSystem,
    github: createGithubSystem,
  };
  (systemCreators[page] || createHeroSystem)();
  createSceneCopy();
  updateResponsiveLayout();

  if (innerWidth > 720 && !reducedMotion) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      0.9,
      0.68,
      0.28,
    );
    composer.addPass(bloom);
  }

  finishBoot();
  window.setTimeout(() => body.classList.remove("is-entering"), reducedMotion ? 0 : 720);
  animate();
}

function animateCursor() {
  if (!cursor || isTouch) return;
  pointer.cursorX = lerp(pointer.cursorX, pointer.clientX, 0.18);
  pointer.cursorY = lerp(pointer.cursorY, pointer.clientY, 0.18);
  const half = cursor.offsetWidth / 2;
  cursor.style.transform = "translate3d(" + (pointer.cursorX - half) + "px," + (pointer.cursorY - half) + "px,0)";
}

function animate() {
  requestAnimationFrame(animate);
  animateCursor();
  if (!renderer || pageHidden) return;

  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  const smooth = reducedMotion ? 1 : 1 - Math.pow(0.0008, delta);

  pointer.x = lerp(pointer.x, pointer.targetX, smooth * 0.4);
  pointer.y = lerp(pointer.y, pointer.targetY, smooth * 0.4);

  entryProgress = clamp(entryProgress + delta * 0.78, 0, 1);
  const entryEase = 1 - Math.pow(1 - entryProgress, 3);
  if (!warpState) {
    camera.position.x = lerp(camera.position.x, pointer.x * 0.38, smooth * 0.52);
    camera.position.y = lerp(camera.position.y, pointer.y * 0.16, smooth * 0.7);
    camera.position.z = lerp(camera.position.z, lerp(19, 12.5, entryEase) + Math.sin(elapsed * 0.14) * 0.12, smooth * 0.68);
    camera.rotation.z = lerp(camera.rotation.z, pointer.x * -0.008, smooth * 0.3);
    camera.lookAt(pointer.x * 0.15, pointer.y * 0.08, -2.7);
  }

  sceneTextMeshes.forEach((mesh, index) => {
    const phase = mesh.userData.phase;
    const drift = reducedMotion ? 0 : Math.sin(elapsed * 0.34 + phase) * mesh.userData.drift;
    mesh.position.z = mesh.userData.basePosition.z + drift;
    mesh.rotation.x = mesh.userData.baseRotation.x + (reducedMotion ? 0 : pointer.y * 0.008 + Math.sin(elapsed * 0.19 + phase) * 0.0025);
    mesh.rotation.y = mesh.userData.baseRotation.y + (reducedMotion ? 0 : pointer.x * (0.012 + index * 0.002));
  });

  organisms.forEach((organism, index) => {
    const phase = organism.userData.phase;
    const pulse = 1 + Math.sin(elapsed * 0.82 + phase) * 0.035;
    const hoverTarget = hoveredRoot === organism ? 1 : 0;
    organism.userData.hoverAmount = lerp(organism.userData.hoverAmount, hoverTarget, smooth * 0.88);
    const hoverAmount = organism.userData.hoverAmount;
    organism.scale.setScalar(organism.userData.baseScale * pulse * (1 + hoverAmount * 0.18));
    organism.rotation.y += delta * (reducedMotion ? 0.012 : (0.08 + (index % 3) * 0.014) * (1 + hoverAmount * 3.4));
    organism.rotation.x = Math.sin(elapsed * 0.21 + phase) * 0.08;
    organism.userData.core.material.uniforms.uTime.value = elapsed + phase;
    organism.userData.core.material.uniforms.uAmplitude.value = 0.055 + hoverAmount * 0.085;
    organism.userData.membrane.rotation.y -= delta * (0.08 + hoverAmount * 0.34);
    organism.userData.nucleus.scale.setScalar(1 + Math.sin(elapsed * 1.7 + phase) * 0.12 + hoverAmount * 0.24);
    const glowSize = 3.9 * (1 + hoverAmount * 0.18);
    organism.userData.glow.scale.set(glowSize, glowSize, 1);
    organism.userData.rings.forEach((ring, ringIndex) => {
      ring.rotation.x += delta * (0.045 + ringIndex * 0.018) * (1 + hoverAmount * 4.2);
      ring.rotation.y -= delta * (0.06 + ringIndex * 0.02) * (1 + hoverAmount * 4.2);
      ring.scale.setScalar(1 + hoverAmount * (0.075 + ringIndex * 0.025));
      const baseOpacity = ring.material.userData.darkOpacity;
      ring.material.opacity = Math.min(1, baseOpacity * (1 + hoverAmount * 0.9));
    });
  });

  animatedNodes.forEach((node, index) => {
    const hovered = hoveredRoot === node;
    const targetScale = node.userData.baseScale * (hovered ? 1.26 : 1);
    const scale = lerp(node.scale.x, targetScale, smooth * 0.8);
    node.scale.setScalar(scale);
    node.rotation.y += delta * (reducedMotion ? 0.01 : 0.18 + (index % 4) * 0.02);
    node.position.z = node.userData.baseZ + Math.sin(elapsed * 0.42 + node.userData.phase) * 0.12;
    node.children.forEach((child) => {
      if (child.material?.uniforms?.uTime) child.material.uniforms.uTime.value = elapsed + node.userData.phase;
    });
  });

  portals.forEach((portal, index) => {
    const hovered = hoveredRoot === portal;
    const baseScale = portal.userData.baseScale || 1;
    const targetScale = baseScale * (hovered ? 1.14 : 1);
    const scale = lerp(portal.scale.x, targetScale, smooth * 0.78);
    portal.scale.setScalar(scale);
    portal.rotation.z = (portal.userData.baseRotationZ || 0) + Math.sin(elapsed * 0.24 + index) * 0.035;
    portal.children.forEach((child) => {
      if (child.material?.uniforms?.uTime) child.material.uniforms.uTime.value = elapsed + index * 0.7;
      if (Number.isInteger(child.userData.portalRing)) {
        child.rotation.z += delta * (0.08 + child.userData.portalRing * 0.035) * (child.userData.portalRing % 2 ? -1 : 1);
      }
    });
  });

  returnBeacons.forEach((beacon, index) => {
    const hovered = hoveredRoot === beacon.userData.root;
    beacon.rotation.z -= delta * (hovered ? 0.92 : 0.28 + index * 0.025);
    const pulse = 1 + Math.sin(elapsed * 1.25 + beacon.userData.phase) * 0.045 + (hovered ? 0.12 : 0);
    beacon.scale.setScalar(pulse);
  });

  constellationStars.forEach((star, index) => {
    const pulse = star.userData.baseScale * (1 + Math.sin(elapsed * 1.35 + star.userData.phase) * 0.16);
    star.scale.setScalar(pulse);
    star.rotation.z += delta * (0.06 + (index % 4) * 0.015);
  });

  constellationGroups.forEach((group) => {
    group.position.z = Math.sin(elapsed * 0.22 + group.userData.phase) * 0.025;
  });

  floatingSpores.forEach((spore, index) => {
    spore.position.y = spore.userData.baseY + Math.sin(elapsed * 0.35 + spore.userData.phase) * 0.16;
    spore.position.x += Math.sin(elapsed * 0.16 + index) * 0.0008;
  });

  scene.children.forEach((child) => {
    if (child.userData.spin) child.rotation.z += child.userData.spin * delta;
    if (child.userData.isStarField) {
      child.rotation.y = elapsed * (reducedMotion ? 0.0002 : 0.0018) + pointer.x * 0.012;
    }
  });

  cosmicEffects.forEach((effect) => {
    if (effect.userData.effectType === "nebula") {
      effect.rotation.z = elapsed * 0.006;
      effect.position.x = Math.sin(elapsed * 0.045 + effect.userData.phase) * 0.55;
      effect.position.y = Math.cos(elapsed * 0.038 + effect.userData.phase) * 0.38;
      return;
    }
    if (effect.userData.effectType !== "comets") return;

    const positions = effect.geometry.attributes.position.array;
    effect.userData.comets.forEach((comet, index) => {
      const x = (((comet.x + elapsed * comet.speed + effect.userData.phase + 24) % 48) + 48) % 48 - 24;
      const stride = index * 6;
      positions[stride] = x;
      positions[stride + 1] = comet.y;
      positions[stride + 2] = comet.z;
      positions[stride + 3] = x - comet.length;
      positions[stride + 4] = comet.y + comet.length * 0.22;
      positions[stride + 5] = comet.z;
    });
    effect.geometry.attributes.position.needsUpdate = true;
  });

  if (warpState) {
    warpState.progress = clamp(warpState.progress + delta * 0.72, 0, 1);
    const t = warpState.progress;
    const warpEase = t * t * t * (t * (t * 6 - 15) + 10);
    const orientationEase = clamp(warpEase * 1.12, 0, 1);
    warpDestination.copy(warpState.targetPosition);
    warpDestination.z += 0.42;
    camera.position.lerpVectors(warpState.startPosition, warpDestination, warpEase);
    camera.position.y += Math.sin(t * Math.PI) * 0.18;

    warpLookMatrix.lookAt(camera.position, warpState.targetPosition, camera.up);
    warpTargetQuaternion.setFromRotationMatrix(warpLookMatrix);
    camera.quaternion.slerpQuaternions(warpState.startQuaternion, warpTargetQuaternion, orientationEase);
    warpRollQuaternion.setFromAxisAngle(warpRollAxis, warpEase * 0.62);
    camera.quaternion.multiply(warpRollQuaternion);

    const baseScale = warpState.root.userData.baseScale || 1;
    warpState.root.scale.setScalar(lerp(warpState.startRootScale, baseScale * 4.4, warpEase));
    renderer.toneMappingExposure = lerp(1.08, 1.75, warpEase);
    if (bloom) bloom.strength = lerp(0.9, 3.1, warpEase);
    if (warpState.progress > 0.52) body.classList.add("is-leaving");
    if (warpState.progress >= 1 && !warpState.navigated) {
      warpState.navigated = true;
      window.location.href = warpState.action;
    }
  } else {
    updateRaycast();
  }
  updateWorldLabels();
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

$$("[data-action]").forEach((element) => {
  const getRoot = () => anchors.get(element.dataset.anchor);
  element.addEventListener("pointerenter", () => {
    const root = getRoot();
    if (root && !warpState) {
      labelHoveredRoot = root;
      hoveredRoot = root;
    }
  });
  element.addEventListener("pointerleave", () => {
    const root = getRoot();
    if (labelHoveredRoot === root) labelHoveredRoot = null;
    if (hoveredRoot === root && !warpState) hoveredRoot = null;
  });
  element.addEventListener("click", (event) => {
    event.preventDefault();
    activateAction(element.dataset.action, getRoot());
  });
});

$$('a[href]:not([target="_blank"])').forEach((link) => {
  if (link.dataset.action) return;
  link.addEventListener("click", (event) => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    event.preventDefault();
    activateAction(href);
  });
});

$$("a, button").forEach((element) => {
  element.addEventListener("pointerenter", () => cursor?.classList.add("is-active"));
  element.addEventListener("pointerleave", () => {
    if (!hoveredRoot) cursor?.classList.remove("is-active");
  });
});

window.addEventListener(
  "pointermove",
  (event) => {
    pointer.clientX = event.clientX;
    pointer.clientY = event.clientY;
    pointer.targetX = (event.clientX / innerWidth) * 2 - 1;
    pointer.targetY = -(event.clientY / innerHeight) * 2 + 1;
    cursor?.classList.add("is-visible");
  },
  { passive: true },
);

window.addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});

window.addEventListener("pointerup", (event) => {
  if (!pointerDown) return;
  const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (hoveredRoot && distance < 8) activateAction(hoveredRoot.userData.action, hoveredRoot);
});

window.addEventListener(
  "resize",
  () => {
    if (!renderer || !camera) return;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 720 ? 1.2 : 1.6));
    renderer.setSize(innerWidth, innerHeight, false);
    composer?.setSize(innerWidth, innerHeight);
    updateResponsiveLayout();
  },
  { passive: true },
);

document.addEventListener("visibilitychange", () => {
  pageHidden = document.hidden;
});

window.addEventListener("pageshow", () => body.classList.remove("is-leaving"));

prefersReducedMotion.addEventListener?.("change", (event) => {
  reducedMotion = event.matches;
});

function startScene() {
  try {
    createScene();
  } catch (error) {
    console.error("No se pudo iniciar la escena 3D.", error);
    body.classList.add("no-webgl");
    finishBoot();
  }
}

const fontGate = document.fonts
  ? Promise.race([
      Promise.all([
        document.fonts.load("700 180px 'Space Grotesk'"),
        document.fonts.load("500 43px 'DM Mono'"),
      ]),
      new Promise((resolve) => window.setTimeout(resolve, 1800)),
    ])
  : Promise.resolve();
fontGate.then(startScene, startScene);

window.setTimeout(finishBoot, 4300);
