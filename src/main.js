import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { createIcons, Camera, CameraOff, ShieldCheck, Volume2, VolumeX } from "lucide";
import { classifyExpression, EXPRESSION_THRESHOLDS, smoothSmile } from "./expression.js";
import { reflectVelocity, segmentEllipseIntersection } from "./physics.js";
import { coverTransform } from "./silhouette.js";
import { SoundEngine } from "./sound.js";
import "./style.css";

createIcons({ icons: { Camera, CameraOff, ShieldCheck, Volume2, VolumeX } });

const $ = (selector) => document.querySelector(selector);
const ui = {
  app: $("#app"),
  video: $("#camera"),
  canvas: $("#fx-canvas"),
  startButton: $("#start-button"),
  retryButton: $("#retry-button"),
  errorPanel: $("#error-panel"),
  errorMessage: $("#error-message"),
  signalLabel: $("#signal-label"),
  smileFill: $("#smile-fill"),
  smileCallout: $("#smile-callout"),
  closeButton: $("#close-button"),
  soundButton: $("#sound-button"),
  captureButton: $("#capture-button"),
  flash: $("#flash"),
  toast: $("#toast"),
};

const PERFORMANCE = {
  cameraWidth: 640,
  cameraHeight: 480,
  cameraFps: 24,
  renderInterval: 1000 / 30,
  inferenceWidth: 384,
  minVisionGap: 52,
  minInferenceInterval: 84,
  maxInferenceInterval: 150,
  maxRain: 56,
  maxFireworks: 180,
  maxSparks: 48,
};

const EXPRESSION = {
  ...EXPRESSION_THRESHOLDS,
  laughOff: 0.32,
  laughHoldMs: 110,
  fireworkCooldownMs: 3800,
};

const palette = ["#62e5ff", "#ff6385", "#fff3cc", "#ffc56e", "#bdcaff"];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ctx = ui.canvas.getContext("2d", { alpha: true, desynchronized: true });
const inferenceCanvas = document.createElement("canvas");
const inferenceContext = inferenceCanvas.getContext("2d", { alpha: false, desynchronized: true });

const state = {
  width: window.innerWidth,
  height: window.innerHeight,
  stream: null,
  landmarker: null,
  visionPromise: null,
  running: false,
  pageVisible: !document.hidden,
  lastVideoTime: -1,
  lastVisionAt: 0,
  lastDetectionAt: 0,
  inferenceInterval: 100,
  lastPoseAt: 0,
  poseInterval: 190,
  nextVisionTask: "face",
  lastRenderAt: performance.now(),
  smoothedSmile: 0,
  lastExpressionAt: 0,
  silhouette: null,
  maskFailures: 0,
  segmentationEnabled: true,
  poseUpdating: false,
  collisionMask: null,
  collisionHead: null,
  isSmiling: false,
  laughArmed: true,
  laughAboveSince: 0,
  lastIgnitionAt: -10000,
  rainAmount: 0,
  rainTarget: 0,
  rainSuppressedUntil: 0,
  expressionMode: "neutral",
  calloutKey: "",
  head: { valid: false, cx: 0, cy: 0, rx: 0, ry: 0, vx: 0, vy: 0, alpha: 0, updatedAt: 0 },
  body: {
    valid: false,
    alpha: 0,
    scale: 90,
    points: [],
    poseColliders: [],
    fallbackColliders: [],
    colliders: [],
    poseMisses: 0,
    shoulderMisses: 0,
    shoulderLastSeenAt: 0,
    shoulderSource: "none",
    updatedAt: 0,
  },
  metrics: {
    renderFps: 0,
    renderMs: 0,
    maskCopyMs: 0,
    inferenceMs: 0,
    poseInferenceMs: 0,
    particleCount: 0,
    collisionCount: 0,
    bodyCollisionCount: 0,
    shoulderCollisionCount: 0,
    poseShoulderCollisionCount: 0,
    fallbackShoulderCollisionCount: 0,
    rainImpactCount: 0,
  },
};

const rain = [];
const rockets = [];
const fireworkParticles = [];
const collisionSparks = [];
const burstFlashes = [];
const rainImpacts = [];
let toastTimer = 0;
let calloutTimer = 0;
let frameCounter = 0;
let fpsWindowStartedAt = performance.now();

const random = (min, max) => min + Math.random() * (max - min);
const lerp = (a, b, amount) => a + (b - a) * amount;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Small cached sprites replace per-particle blur and per-frame gradients.
const glowSprites = new Map();
function drawGlow(context, x, y, size, color, alpha) {
  let sprite = glowSprites.get(color);
  if (!sprite) {
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = 48;
    const painter = sprite.getContext("2d");
    const gradient = painter.createRadialGradient(24, 24, 0, 24, 24, 24);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.12, color);
    gradient.addColorStop(0.35, `${color}70`);
    gradient.addColorStop(1, `${color}00`);
    painter.fillStyle = gradient;
    painter.fillRect(0, 0, 48, 48);
    glowSprites.set(color, sprite);
  }
  context.globalAlpha = alpha;
  context.drawImage(sprite, x - size, y - size, size * 2, size * 2);
}

const sound = new SoundEngine();

class RainDrop {
  constructor() {
    this.active = false;
    this.phase = random(0, Math.PI * 2);
    this.reset(true);
  }

  reset(initial = false) {
    this.depth = random(0.62, 1.18);
    this.x = random(-50, state.width + 50);
    this.y = initial ? random(-40, state.height) : random(-70, -10);
    this.length = random(26, 48) * this.depth;
    this.speed = random(440, 760) * this.depth;
    this.wind = random(-58, -28) * this.depth;
    this.vx = this.wind;
    this.vy = this.speed;
    this.age = random(0, 3);
    this.opacity = random(0.7, 1);
    this.width = random(1.2, 2.05) * this.depth;
    this.bounced = false;
  }

  update(dt) {
    this.age += dt;
    const previousX = this.x;
    const previousY = this.y;
    if (!this.bounced) {
      const gust = Math.sin(performance.now() * 0.0007) * 22 + Math.sin(this.age * 1.2 + this.phase) * 5;
      this.vx = lerp(this.vx, this.wind + gust, 1 - Math.exp(-dt * 3));
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.bounced) {
      this.vx *= 0.992;
      this.vy += 920 * dt;
    }

    if (!this.bounced) {
      const hit = findPersonCollision(previousX, previousY, this.x, this.y);
      if (hit) {
        const reflected = reflectVelocity(this.vx - hit.vx, this.vy - hit.vy, hit.normalX, hit.normalY, 0.32, 0.62);
        this.x = hit.x + hit.normalX * 2.5;
        this.y = hit.y + hit.normalY * 2.5;
        this.vx = reflected.vx + hit.vx;
        this.vy = reflected.vy + hit.vy;
        this.bounced = true;
        this.length = random(4, 7);
        createRainSplash(hit.x, hit.y, hit.normalX, hit.normalY, hit.part);
        sound.rainDrop(0.7);
        recordPersonCollision(hit.part);
        return;
      }
    }

    if (this.y > state.height + 30 || this.y < -120 || this.x < -120 || this.x > state.width + 120) this.reset();
  }
}

class Rocket {
  constructor(startX, targetX, targetY, color, delay = 0) {
    this.startX = startX;
    this.startY = state.height + 24;
    this.x = startX;
    this.y = this.startY;
    this.previousX = startX;
    this.previousY = this.startY;
    this.targetX = targetX;
    this.targetY = targetY;
    this.color = color;
    this.delay = delay;
    this.age = 0;
    this.duration = random(1.05, 1.35);
    this.curve = random(-24, 24);
    this.history = new Float32Array(36);
    this.historyCount = 0;
    this.launched = false;
    this.dead = false;
  }

  update(dt) {
    this.age += dt;
    if (this.age < this.delay) return;
    if (!this.launched) {
      this.launched = true;
      sound.launch(this.duration, this.startX / state.width * 2 - 1);
    }
    const progress = clamp((this.age - this.delay) / this.duration, 0, 1);
    const eased = 1 - (1 - progress) ** 1.8;
    this.previousX = this.x;
    this.previousY = this.y;
    const bend = Math.sin(progress * Math.PI);
    this.x = lerp(this.startX, this.targetX, eased) + bend * this.curve;
    this.y = lerp(this.startY, this.targetY, eased);
    this.history.copyWithin(2, 0, 34);
    this.history[0] = this.x;
    this.history[1] = this.y;
    this.historyCount = Math.min(18, this.historyCount + 1);
    if (progress >= 1) {
      this.dead = true;
      createBurst(this.targetX, this.targetY, this.color);
    }
  }

  draw(context) {
    if (this.age < this.delay) return;
    const progress = clamp((this.age - this.delay) / this.duration, 0, 1);
    for (let i = this.historyCount - 1; i > 0; i -= 1) {
      const freshness = 1 - i / this.historyCount;
      const x = this.history[i * 2];
      const y = this.history[i * 2 + 1];
      context.globalAlpha = freshness * 0.8;
      context.strokeStyle = i < 4 ? "#fff5d8" : "#ffc56e";
      context.lineWidth = 0.5 + freshness * 2.2;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(this.history[(i - 1) * 2], this.history[(i - 1) * 2 + 1]);
      context.stroke();
      // Exhaust keeps falling and spreading after the shell has passed.
      const emberAge = i / 30;
      for (let side = -1; side <= 1; side += 2) {
        const spread = Math.sin(i * 2.4 + this.startX) * 8 + side * emberAge * 17;
        drawGlow(context, x + spread, y + 65 * emberAge * emberAge, 2 + freshness * 2, "#ffc56e", freshness * 0.6);
      }
    }
    drawGlow(context, this.x, this.y, 12 + Math.sin(this.age * 37) * 1.5, "#ffc56e", 0.9);
    drawGlow(context, this.x, this.y, 4, "#fff3cc", 1 - progress * 0.25);
  }
}

class Particle {
  constructor(x, y, vx, vy, color, kind = "firework") {
    this.x = x;
    this.y = y;
    this.previousX = x;
    this.previousY = y;
    this.trailX = x;
    this.trailY = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.kind = kind;
    this.age = 0;
    this.life = kind === "rain" ? random(0.24, 0.42) : kind === "spark" ? random(0.24, 0.42) : random(2.1, 3.2);
    this.size = kind === "rain" ? random(1.6, 2.2) : kind === "spark" ? 1.2 : random(1.3, 2);
    this.drag = kind === "rain" ? 0.97 : kind === "spark" ? 0.96 : random(0.979, 0.99);
    this.gravity = kind === "rain" ? 600 : kind === "spark" ? 280 : random(105, 145);
    this.history = kind === "firework" ? new Float32Array(20) : null;
    this.historyCount = 0;
    this.twinkle = random(0, Math.PI * 2);
    this.delay = 0;
    this.drift = random(-18, 18);
    this.collisions = 0;
    this.dead = false;
  }

  update(dt) {
    this.age += dt;
    if (this.age < this.delay) return;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }

    this.trailX = this.previousX;
    this.trailY = this.previousY;
    this.previousX = this.x;
    this.previousY = this.y;
    if (this.history) {
      this.history.copyWithin(2, 0, 18);
      this.history[0] = this.x;
      this.history[1] = this.y;
      this.historyCount = Math.min(10, this.historyCount + 1);
    }
    const drag = this.drag ** (dt * 60);
    this.vx *= drag;
    this.vy = this.vy * drag + this.gravity * dt;
    if (this.kind === "firework") {
      this.vx += Math.sin(this.age * 2.4 + this.twinkle) * this.drift * dt;
      this.vy += Math.cos(this.age * 1.7 + this.twinkle) * this.drift * 0.22 * dt;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.kind === "firework" && this.collisions === 0) resolvePersonCollision(this);
    if (this.y > state.height + 80 || this.x < -100 || this.x > state.width + 100) this.dead = true;
  }

  draw(context) {
    if (this.age < this.delay) return;
    const remaining = 1 - this.age / this.life;
    const flicker = remaining < 0.35 ? 0.65 + Math.sin(this.age * 24 + this.twinkle) * 0.35 : 1;
    const alpha = Math.min(1, Math.max(0, remaining) * 2.5) * flicker;
    context.strokeStyle = this.color;
    if (this.kind === "firework") {
      for (let band = 2; band >= 0; band -= 1) {
        const start = Math.floor(band * this.historyCount / 3);
        const end = Math.floor((band + 1) * this.historyCount / 3);
        context.globalAlpha = alpha * (0.7 - band * 0.23);
        context.strokeStyle = remaining < 0.45 ? "#ffc56e" : this.color;
        context.lineWidth = this.size * (1 - band * 0.26);
        context.beginPath();
        context.moveTo(start ? this.history[(start - 1) * 2] : this.x, start ? this.history[(start - 1) * 2 + 1] : this.y);
        for (let i = start; i < end; i += 1) context.lineTo(this.history[i * 2], this.history[i * 2 + 1]);
        context.stroke();
      }
      drawGlow(context, this.x, this.y, this.size * 3.6, this.color, alpha * 0.75);
      return;
    }
    context.globalAlpha = alpha * (this.kind === "spark" ? 0.9 : 1);
    context.lineWidth = this.size;
    context.beginPath();
    context.moveTo(this.trailX, this.trailY);
    context.lineTo(this.x, this.y);
    context.stroke();
  }
}

function resizeCanvas() {
  state.silhouette = null;
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  ui.canvas.width = state.width;
  ui.canvas.height = state.height;
  ui.canvas.style.width = `${state.width}px`;
  ui.canvas.style.height = `${state.height}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  seedRain();
}

function seedRain() {
  while (rain.length < PERFORMANCE.maxRain) rain.push(new RainDrop());
  if (rain.length > PERFORMANCE.maxRain) rain.length = PERFORMANCE.maxRain;
}

function createRainSplash(x, y, normalX, normalY, part = "body") {
  state.metrics.rainImpactCount += 1;
  const strength = part === "head" || part === "pose-head" ? 1 : 0.82;
  if (rainImpacts.length < 12) {
    rainImpacts.push({ x, y, normalX, normalY, age: 0, life: 0.32, strength, part });
  }
  const baseAngle = Math.atan2(normalY, normalX);
  for (let i = 0; i < 4 && collisionSparks.length < PERFORMANCE.maxSparks; i += 1) {
    const angle = baseAngle + (i - 1.5) * 0.48 + random(-0.14, 0.14);
    const speed = random(90, 170);
    collisionSparks.push(new Particle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, i === 1 ? "#ffffff" : "#8bf7ff", "rain"));
  }
}

function recordPersonCollision(part) {
  state.metrics.collisionCount += 1;
  if (part !== "head" && part !== "pose-head") state.metrics.bodyCollisionCount += 1;
  if (part.includes("shoulder")) {
    state.metrics.shoulderCollisionCount += 1;
    if (!part.startsWith("fallback")) state.metrics.poseShoulderCollisionCount += 1;
    if (part === "fallback-shoulders") state.metrics.fallbackShoulderCollisionCount += 1;
  }
}

function findPersonCollision(x0, y0, x1, y1) {
  if (!state.collisionHead) return null;
  const hit = segmentEllipseIntersection(x0, y0, x1, y1, state.collisionHead);
  return hit ? { ...hit, vx: state.collisionHead.vx, vy: state.collisionHead.vy, part: "head", source: "face" } : null;
}

function resolvePersonCollision(particle) {
  const hit = findPersonCollision(particle.previousX, particle.previousY, particle.x, particle.y);
  if (!hit) return;

  const relativeVx = particle.vx - hit.vx;
  const relativeVy = particle.vy - hit.vy;
  const reflected = reflectVelocity(relativeVx, relativeVy, hit.normalX, hit.normalY, 0.58, 0.86);
  particle.x = hit.x + hit.normalX * 2.5;
  particle.y = hit.y + hit.normalY * 2.5;
  particle.previousX = hit.x;
  particle.previousY = hit.y;
  particle.historyCount = 0;
  particle.vx = reflected.vx + hit.vx;
  particle.vy = reflected.vy + hit.vy;
  particle.color = "#ffffff";
  particle.size = 2.1;
  particle.collisions = 1;
  particle.life = Math.max(particle.life, particle.age + 0.65);
  recordPersonCollision(hit.part);

  if (burstFlashes.length < 12) {
    burstFlashes.push({
      x: hit.x,
      y: hit.y,
      color: hit.part.includes("shoulder") ? "#25f4ee" : "#ffffff",
      age: 0,
      life: 0.3,
      impact: true,
      normalX: hit.normalX,
      normalY: hit.normalY,
      part: hit.part,
    });
  }

  for (let i = 0; i < 3 && collisionSparks.length < PERFORMANCE.maxSparks; i += 1) {
    const angle = Math.atan2(hit.normalY, hit.normalX) + random(-0.85, 0.85);
    const speed = random(80, 140);
    collisionSparks.push(
      new Particle(hit.x, hit.y, Math.cos(angle) * speed, Math.sin(angle) * speed, i === 0 ? "#25f4ee" : "#fe2c55", "spark"),
    );
  }
}

function addFireworkParticle(particle) {
  if (fireworkParticles.length < PERFORMANCE.maxFireworks) fireworkParticles.push(particle);
}

function createBurst(x, y, baseColor) {
  if (burstFlashes.length < 12) burstFlashes.push({ x, y, color: baseColor, age: 0, life: 0.24, impact: false });
  const radialCount = prefersReducedMotion ? 30 : 58;
  const spread = clamp(Math.min(state.width, state.height) / 540, 0.7, 1.25);
  const rotation = random(0, Math.PI * 2);
  const willow = Math.random() < 0.4;
  for (let i = 0; i < radialCount; i += 1) {
    // A projected sphere gives varied depth without three conspicuous concentric rings.
    const z = 1 - 2 * (i + 0.5) / radialCount;
    const angle = i * 2.399963 + rotation;
    const speed = Math.sqrt(1 - z * z) * random(285, 370) * spread;
    const color = willow ? (i % 5 === 0 ? baseColor : "#ffc56e") : (i % 6 === 0 ? "#fff3cc" : baseColor);
    const particle = new Particle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed * random(0.9, 1), color);
    particle.size = random(1.1, 2) * (0.85 + (z + 1) * 0.15);
    if (willow) { particle.life += 0.4; particle.drag = 0.989; particle.gravity = 145; }
    addFireworkParticle(particle);
  }
  sound.boom(random(0.72, 0.95), x / state.width * 2 - 1);
}

function igniteSky(now) {
  state.lastIgnitionAt = now;
  state.rainSuppressedUntil = now + 1600;
  const head = state.head.valid
    ? state.head
    : { cx: state.width / 2, cy: state.height * 0.48, rx: 90, ry: 120 };
  const safeTop = Math.max(96, state.height * 0.12);
  const topY = clamp(head.cy - head.ry * 1.48, safeTop, state.height * 0.48);
  const sideY = clamp(head.cy - head.ry * 0.92, safeTop + 30, state.height * 0.53);
  const margin = Math.max(58, state.width * 0.1);
  const targets = [
    { x: clamp(head.cx, margin, state.width - margin), y: topY },
    { x: clamp(head.cx - head.rx * 1.18, margin, state.width - margin), y: sideY },
    { x: clamp(head.cx + head.rx * 1.18, margin, state.width - margin), y: sideY + 18 },
  ];

  targets.forEach((target, index) => {
    rockets.push(
      new Rocket(
        index === 0 ? state.width * 0.5 : index === 1 ? state.width * 0.18 : state.width * 0.82,
        target.x,
        target.y,
        palette[Math.floor(Math.random() * palette.length)],
        index * random(0.22, 0.38),
      ),
    );
  });
  setCallout("LAUGH DETECTED", "FIREWORKS", true, 1700);
}

function setCallout(label, value, ignited = false, duration = 0) {
  const key = `${label}|${value}|${ignited}`;
  if (key === state.calloutKey && !duration) return;
  state.calloutKey = key;
  clearTimeout(calloutTimer);
  ui.smileCallout.classList.toggle("ignited", ignited);
  ui.smileCallout.querySelector("span").textContent = label;
  ui.smileCallout.querySelector("strong").textContent = value;
  if (duration) calloutTimer = window.setTimeout(updateCalloutForMode, duration);
}

function updateCalloutForMode() {
  if (state.expressionMode === "rain") setCallout("SMILE DETECTED", "RAINING");
  else setCallout("EXPRESSION WEATHER", "READY");
}

function drawRain(context, dt, now) {
  const target = now < state.rainSuppressedUntil ? 0 : state.rainTarget;
  state.rainAmount = lerp(state.rainAmount, target, 1 - Math.exp(-dt * (target > state.rainAmount ? 9 : 6)));
  sound.setRain(state.rainAmount);
  if (state.rainAmount < 0.015) {
    state.rainAmount = 0;
    rain.forEach((drop) => { drop.active = false; });
    return;
  }

  const activeCount = clamp(Math.ceil(PERFORMANCE.maxRain * state.rainAmount), 0, PERFORMANCE.maxRain);
  const fade = Math.min(1, state.rainAmount / 0.4);
  const underlayAlpha = 0.3 * fade;
  const coreAlpha = 0.95 * fade;
  for (let i = 0; i < activeCount; i += 1) {
    const drop = rain[i];
    if (!drop.active) {
      drop.active = true;
      drop.reset(true);
    }
    drop.update(dt);
    const velocityLength = Math.hypot(drop.vx, drop.vy) || 1;
    const trailScale = drop.length / velocityLength;
    context.globalAlpha = underlayAlpha * drop.opacity;
    context.strokeStyle = "#294452";
    context.lineWidth = drop.width + 1.6;
    context.beginPath();
    context.moveTo(drop.x, drop.y);
    context.lineTo(drop.x - drop.vx * trailScale, drop.y - drop.vy * trailScale);
    context.stroke();
    context.globalAlpha = coreAlpha * drop.opacity;
    context.strokeStyle = i % 3 === 0 ? "#bbdce9" : "#effaff";
    context.lineWidth = drop.width;
    context.beginPath();
    context.moveTo(drop.x, drop.y);
    context.lineTo(drop.x - drop.vx * trailScale * 0.86, drop.y - drop.vy * trailScale * 0.86);
    context.stroke();
  }
  for (let i = activeCount; i < rain.length; i += 1) rain[i].active = false;
}

function drawRainImpacts(context, dt) {
  let writeIndex = 0;
  for (let i = 0; i < rainImpacts.length; i += 1) {
    const impact = rainImpacts[i];
    impact.age += dt;
    if (impact.age >= impact.life) continue;
    const progress = impact.age / impact.life;
    const angle = Math.atan2(impact.normalY, impact.normalX);
    const tangent = angle + Math.PI * 0.5;
    const radius = 2 + progress * 10 * impact.strength;
    context.globalAlpha = (1 - progress) * 0.64 * impact.strength;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(impact.x - Math.cos(tangent) * radius, impact.y - Math.sin(tangent) * radius);
    context.lineTo(impact.x + Math.cos(tangent) * radius, impact.y + Math.sin(tangent) * radius);
    context.stroke();
    context.globalAlpha = (1 - progress) * 0.72;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;
    context.beginPath();
    context.globalAlpha = (1 - progress) * 0.95;
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(impact.x, impact.y, Math.max(0.5, 1.7 * (1 - progress)), 0, Math.PI * 2);
    context.fill();
    rainImpacts[writeIndex] = impact;
    writeIndex += 1;
  }
  rainImpacts.length = writeIndex;
}

function compactAndDrawParticles(list, context, dt) {
  let writeIndex = 0;
  for (let i = 0; i < list.length; i += 1) {
    const particle = list[i];
    particle.update(dt);
    if (!particle.dead) {
      particle.draw(context);
      list[writeIndex] = particle;
      writeIndex += 1;
    }
  }
  list.length = writeIndex;
}

function drawBurstFlashes(context, dt) {
  let writeIndex = 0;
  for (let i = 0; i < burstFlashes.length; i += 1) {
    const flash = burstFlashes[i];
    flash.age += dt;
    if (flash.age >= flash.life) continue;
    const progress = flash.age / flash.life;
    if (flash.impact) {
      const normalAngle = Math.atan2(flash.normalY ?? -1, flash.normalX ?? 0);
      const impactPulse = Math.sin(progress * Math.PI);
      context.globalAlpha = (1 - progress) * 0.28 * impactPulse;
      context.fillStyle = flash.color;
      context.beginPath();
      context.arc(flash.x, flash.y, 8 + impactPulse * 18, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = (1 - progress) * 0.85;
      context.strokeStyle = flash.color;
      context.lineWidth = 1.5;
      context.beginPath();
      for (let ray = 0; ray < 7; ray += 1) {
        const angle = normalAngle + (ray - 3) * 0.44;
        const inner = 2 + progress * 3;
        const outer = 8 + progress * 18;
        context.moveTo(flash.x + Math.cos(angle) * inner, flash.y + Math.sin(angle) * inner);
        context.lineTo(flash.x + Math.cos(angle) * outer, flash.y + Math.sin(angle) * outer);
      }
      context.stroke();
      context.globalAlpha = (1 - progress) * 0.7;
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(flash.x, flash.y, 4 + progress * 10, normalAngle - 1.15, normalAngle + 1.15);
      context.stroke();
    } else {
      drawGlow(context, flash.x, flash.y, 26 + progress * 42, flash.color, (1 - progress) ** 2 * 0.85);
    }
    context.globalAlpha = (1 - progress) * 0.9;
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(flash.x, flash.y, Math.max(0.5, (flash.impact ? 2 : 4) * (1 - progress)), 0, Math.PI * 2);
    context.fill();
    burstFlashes[writeIndex] = flash;
    writeIndex += 1;
  }
  burstFlashes.length = writeIndex;
}

function drawScene(now) {
  requestAnimationFrame(drawScene);
  const elapsed = now - state.lastRenderAt;
  if (!state.pageVisible || elapsed < PERFORMANCE.renderInterval) return;

  const renderStartedAt = performance.now();
  const dt = clamp((now - (state.lastSimulationAt ?? now - PERFORMANCE.renderInterval)) / 1000, 0.001, 0.05);
  state.lastSimulationAt = now;
  state.lastRenderAt = now - (elapsed % PERFORMANCE.renderInterval);
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "source-over";
  predictPoseColliders(now);
  state.collisionMask = state.silhouette && now - state.silhouette.updatedAt < 360 ? state.silhouette : null;
  state.collisionHead = null;
  if (state.head.valid && now - state.head.updatedAt < 360) {
    const headAge = clamp((now - state.head.updatedAt) / 1000, 0, 0.08);
    state.collisionHead = { ...state.head, cx: state.head.cx + state.head.vx * headAge, cy: state.head.cy + state.head.vy * headAge };
  }
  drawRain(ctx, dt, now);

  ctx.globalCompositeOperation = "lighter";
  drawRainImpacts(ctx, dt);
  let rocketWriteIndex = 0;
  for (let i = 0; i < rockets.length; i += 1) {
    const rocket = rockets[i];
    rocket.update(dt);
    if (!rocket.dead) {
      rocket.draw(ctx);
      rockets[rocketWriteIndex] = rocket;
      rocketWriteIndex += 1;
    }
  }
  rockets.length = rocketWriteIndex;
  drawBurstFlashes(ctx, dt);
  compactAndDrawParticles(fireworkParticles, ctx, dt);
  compactAndDrawParticles(collisionSparks, ctx, dt);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  state.metrics.renderMs = lerp(state.metrics.renderMs, performance.now() - renderStartedAt, 0.08);

  state.metrics.particleCount = rockets.length + fireworkParticles.length + collisionSparks.length + Math.round(PERFORMANCE.maxRain * state.rainAmount);
  frameCounter += 1;
  if (now - fpsWindowStartedAt > 1000) {
    state.metrics.renderFps = Math.round((frameCounter * 1000) / (now - fpsWindowStartedAt));
    ui.app.dataset.metrics = `${state.metrics.renderFps}fps/${state.metrics.particleCount}p/${state.metrics.collisionCount}c/${state.metrics.poseShoulderCollisionCount}ps/${state.metrics.fallbackShoulderCollisionCount}fs/${state.metrics.rainImpactCount}r`;
    if (import.meta.env.DEV && ui.app.dataset.state === "live" && new URLSearchParams(window.location.search).has("demo")) {
      ui.signalLabel.textContent = `QA ${ui.app.dataset.metrics}`;
    }
    frameCounter = 0;
    fpsWindowStartedAt = now;
  }
  if (state.running) detectVision(now);
}

function projectLandmark(landmark) {
  const transform = cameraTransform();
  return { x: transform.ox + landmark.x * transform.sx, y: transform.oy + landmark.y * transform.sy };
}

function cameraTransform() {
  return coverTransform(ui.video.videoWidth || state.width, ui.video.videoHeight || state.height, state.width, state.height, true);
}

function updateHeadCollider(landmarks, now) {
  const left = projectLandmark(landmarks[234]);
  const right = projectLandmark(landmarks[454]);
  const top = projectLandmark(landmarks[10]);
  const bottom = projectLandmark(landmarks[152]);
  const faceWidth = Math.abs(right.x - left.x);
  const faceHeight = Math.abs(bottom.y - top.y);
  const targetX = (left.x + right.x) / 2;
  const targetY = (top.y + bottom.y) / 2 - faceHeight * 0.13;
  const elapsed = Math.max(0.04, (now - state.head.updatedAt) / 1000);
  const previousX = state.head.cx;
  const previousY = state.head.cy;
  const amount = state.head.valid ? 0.76 : 1;

  state.head.cx = lerp(state.head.cx, targetX, amount);
  state.head.cy = lerp(state.head.cy, targetY, amount);
  state.head.rx = lerp(state.head.rx, faceWidth * 0.64, amount);
  state.head.ry = lerp(state.head.ry, faceHeight * 0.74, amount);
  state.head.vx = state.head.valid ? clamp((state.head.cx - previousX) / elapsed, -220, 220) : 0;
  state.head.vy = state.head.valid ? clamp((state.head.cy - previousY) / elapsed, -220, 220) : 0;
  state.head.alpha = lerp(state.head.alpha, 1, 0.3);
  state.head.updatedAt = now;
  state.head.valid = true;
  updateFallbackBodyColliders();
}

function refreshBodyColliders() {
  const body = state.body;
  const hasPoseShoulders = body.poseColliders.some((collider) => collider.part === "shoulders");
  body.shoulderSource = hasPoseShoulders ? "pose" : "none";
  body.colliders = body.poseColliders;
  body.valid = body.colliders.length > 0;
  if (!hasPoseShoulders && body.fallbackColliders.length) body.alpha = Math.max(body.alpha, state.head.alpha);
}

function predictPoseColliders(now) {
  const body = state.body;
  if (body.updatedAt && now - body.updatedAt > 360) {
    body.poseColliders.length = 0;
    refreshBodyColliders();
    return;
  }
  if (body.shoulderSource !== "pose" || !body.updatedAt || !body.poseColliders.length) return;

  // Pose Lite runs a few times per second for the performance budget. Keep the
  // collision body moving between detections, but only for a short horizon so
  // a missed frame cannot make the body drift away from the real person.
  const age = clamp((now - body.updatedAt) / 1000, 0, 0.08);
  for (const collider of body.poseColliders) {
    if (!Number.isFinite(collider.baseAx)) continue;
    collider.ax = collider.baseAx + (collider.avx ?? collider.vx) * age;
    collider.ay = collider.baseAy + (collider.avy ?? collider.vy) * age;
    collider.bx = collider.baseBx + (collider.bvx ?? collider.vx) * age;
    collider.by = collider.baseBy + (collider.bvy ?? collider.vy) * age;
  }
}

function updateFallbackBodyColliders() {
  state.body.fallbackColliders.length = 0;
  refreshBodyColliders();
}

function updateBodyColliders(landmarks, now) {
  const body = state.body;
  const elapsed = body.updatedAt ? Math.max(0.05, (now - body.updatedAt) / 1000) : 0.1;
  const nextPoints = body.points.slice();

  for (let index = 0; index < landmarks.length; index += 1) {
    const landmark = landmarks[index];
    const confidence = Math.min(landmark.visibility ?? 1, landmark.presence ?? 1);
    const previous = body.points[index];
    const isShoulder = index === 11 || index === 12;
    if (confidence < 0.2) {
      const canHoldShoulder = isShoulder && previous?.lastSeenAt && now - previous.lastSeenAt < 260;
      if (canHoldShoulder) {
        nextPoints[index] = {
          ...previous,
          vx: previous.vx * 0.55,
          vy: previous.vy * 0.55,
          observed: false,
          valid: true,
        };
      } else if (previous) nextPoints[index] = { ...previous, observed: false, valid: false };
      continue;
    }

    const target = projectLandmark(landmark);
    const fastJoint = index >= 11 && index <= 20;
    const amount = previous?.valid ? (fastJoint ? 0.74 : 0.56) : 1;
    const x = previous?.valid ? lerp(previous.x, target.x, amount) : target.x;
    const y = previous?.valid ? lerp(previous.y, target.y, amount) : target.y;
    nextPoints[index] = {
      x,
      y,
      vx: previous?.valid ? clamp((x - previous.x) / elapsed, -480, 480) : 0,
      vy: previous?.valid ? clamp((y - previous.y) / elapsed, -480, 480) : 0,
      lastSeenAt: now,
      observed: true,
      valid: true,
    };
  }

  body.points = nextPoints;
  const point = (index) => nextPoints[index]?.valid ? nextPoints[index] : null;
  const midpoint = (a, b) => a && b ? {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    vx: (a.vx + b.vx) / 2,
    vy: (a.vy + b.vy) / 2,
    valid: true,
  } : null;
  const distance = (a, b) => a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const leftShoulder = point(11);
  const rightShoulder = point(12);
  const leftHip = point(23);
  const rightHip = point(24);
  const shoulderWidth = distance(leftShoulder, rightShoulder);
  const hipWidth = distance(leftHip, rightHip);
  const measuredScale = Math.max(shoulderWidth, hipWidth * 1.15);
  if (measuredScale > 24) body.scale = lerp(body.scale, measuredScale, body.valid ? 0.3 : 1);
  body.scale = clamp(body.scale, 42, Math.min(state.width * 0.7, state.height * 0.48));

  const colliders = [];
  const addCapsule = (part, start, end, radius) => {
    if (!start || !end) return;
    colliders.push({
      part,
      ax: start.x,
      ay: start.y,
      bx: end.x,
      by: end.y,
      baseAx: start.x,
      baseAy: start.y,
      baseBx: end.x,
      baseBy: end.y,
      radius,
      avx: start.vx,
      avy: start.vy,
      bvx: end.vx,
      bvy: end.vy,
      vx: (start.vx + end.vx) / 2,
      vy: (start.vy + end.vy) / 2,
    });
  };
  const radius = (factor, minimum, maximum = 46) => clamp(body.scale * factor, minimum, maximum);

  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const chest = shoulderCenter && hipCenter ? { ...shoulderCenter, x: lerp(shoulderCenter.x, hipCenter.x, 0.28), y: lerp(shoulderCenter.y, hipCenter.y, 0.28) } : null;
  addCapsule("torso", chest, hipCenter, radius(0.26, 16, 48));
  addCapsule("shoulders", leftShoulder, rightShoulder, radius(0.095, 7, 22));
  // Pose shoulder landmarks mark the joint center. Add short joint pads so
  // impact tests cover the deltoid area instead of only the line between both
  // shoulders, which also prevents the torso collider from swallowing hits.
  addCapsule("left-shoulder-pad", leftShoulder, leftShoulder, radius(0.12, 8, 24));
  addCapsule("right-shoulder-pad", rightShoulder, rightShoulder, radius(0.12, 8, 24));
  addCapsule("hips", leftHip, rightHip, radius(0.11, 8, 20));

  addCapsule("left-upper-arm", leftShoulder, point(13), radius(0.095, 8, 19));
  addCapsule("left-elbow-pad", point(13), point(13), radius(0.105, 8, 18));
  addCapsule("left-forearm", point(13), point(15), radius(0.08, 7, 16));
  addCapsule("left-wrist-pad", point(15), point(15), radius(0.085, 7, 15));
  addCapsule("left-hand", point(15), point(19), radius(0.07, 6, 14));
  addCapsule("left-hand-palm", point(15), midpoint(point(17), point(19)), radius(0.095, 8, 16));
  addCapsule("right-upper-arm", rightShoulder, point(14), radius(0.095, 8, 19));
  addCapsule("right-elbow-pad", point(14), point(14), radius(0.105, 8, 18));
  addCapsule("right-forearm", point(14), point(16), radius(0.08, 7, 16));
  addCapsule("right-wrist-pad", point(16), point(16), radius(0.085, 7, 15));
  addCapsule("right-hand", point(16), point(20), radius(0.07, 6, 14));
  addCapsule("right-hand-palm", point(16), midpoint(point(18), point(20)), radius(0.095, 8, 16));

  addCapsule("left-thigh", leftHip, point(25), radius(0.12, 9, 25));
  addCapsule("left-calf", point(25), point(27), radius(0.09, 7, 21));
  addCapsule("left-foot", point(27), point(31), radius(0.065, 6, 16));
  addCapsule("right-thigh", rightHip, point(26), radius(0.12, 9, 25));
  addCapsule("right-calf", point(26), point(28), radius(0.09, 7, 21));
  addCapsule("right-foot", point(28), point(32), radius(0.065, 6, 16));

  const leftEar = point(7);
  const rightEar = point(8);
  const earCenter = midpoint(leftEar, rightEar);
  if (earCenter) {
    const headRadius = Math.max(radius(0.13, 11, 34), distance(leftEar, rightEar) * 0.72);
    addCapsule("pose-head", earCenter, earCenter, headRadius);
  }

  body.poseColliders = colliders;
  body.poseMisses = 0;
  if (leftShoulder?.observed && rightShoulder?.observed) {
    body.shoulderMisses = 0;
    body.shoulderLastSeenAt = performance.now();
    body.fallbackColliders.length = 0;
  } else {
    body.shoulderMisses += 1;
  }
  body.alpha = lerp(body.alpha, colliders.length ? 1 : 0, 0.32);
  body.updatedAt = now;
  refreshBodyColliders();
}

function fadeBodyTracking() {
  const body = state.body;
  body.poseMisses += 1;
  body.shoulderMisses += 1;
  if (body.poseMisses >= 3) {
    body.poseColliders.length = 0;
    body.alpha = lerp(body.alpha, body.fallbackColliders.length ? state.head.alpha : 0, 0.28);
  }
  updateFallbackBodyColliders();
  refreshBodyColliders();
}

function getSmileScore(blendshapes) {
  let mouthLeft = 0;
  let mouthRight = 0;
  let cheekLeft = 0;
  let cheekRight = 0;
  for (const shape of blendshapes) {
    if (shape.categoryName === "mouthSmileLeft") mouthLeft = shape.score;
    else if (shape.categoryName === "mouthSmileRight") mouthRight = shape.score;
    else if (shape.categoryName === "cheekSquintLeft") cheekLeft = shape.score;
    else if (shape.categoryName === "cheekSquintRight") cheekRight = shape.score;
  }
  return clamp((mouthLeft + mouthRight) * 0.43 + (cheekLeft + cheekRight) * 0.07, 0, 1);
}

function updateExpression(rawScore, now) {
  state.smoothedSmile = smoothSmile(state.smoothedSmile, rawScore, state.lastExpressionAt ? now - state.lastExpressionAt : 100);
  state.lastExpressionAt = now;
  ui.smileFill.style.width = `${Math.round(state.smoothedSmile * 100)}%`;
  const expression = classifyExpression(state.smoothedSmile, state.isSmiling, EXPRESSION);
  state.isSmiling = expression.isSmiling;

  if (expression.mode === "laugh") {
    if (!state.laughAboveSince) state.laughAboveSince = now;
    const stable = now - state.laughAboveSince >= EXPRESSION.laughHoldMs;
    const cooledDown = now - state.lastIgnitionAt >= EXPRESSION.fireworkCooldownMs;
    if (stable && cooledDown && state.laughArmed) {
      state.laughArmed = false;
      igniteSky(now);
    }
    state.expressionMode = "laugh";
    state.rainTarget = 0;
    ui.signalLabel.textContent = "LAUGH LOCKED";
  } else if (expression.mode === "rain") {
    state.laughAboveSince = 0;
    if (state.smoothedSmile < EXPRESSION.laughOff) state.laughArmed = true;
    state.expressionMode = "rain";
    state.rainTarget = clamp(0.62 + (state.smoothedSmile - EXPRESSION.rainOn) * 1.3, 0.62, 1);
    ui.signalLabel.textContent = "SMILE / RAIN";
    if (now > state.rainSuppressedUntil && !ui.smileCallout.classList.contains("ignited")) {
      setCallout("SMILE DETECTED", "RAINING");
    }
  } else {
    state.laughAboveSince = 0;
    if (state.smoothedSmile < EXPRESSION.laughOff) state.laughArmed = true;
    state.expressionMode = "neutral";
    state.rainTarget = 0;
    ui.signalLabel.textContent = state.body.valid ? "BODY TRACKED" : "FACE TRACKED";
    if (!ui.smileCallout.classList.contains("ignited")) setCallout("EXPRESSION WEATHER", "READY");
  }
}

function prepareInferenceCanvases() {
  const videoWidth = ui.video.videoWidth || PERFORMANCE.cameraWidth;
  const videoHeight = ui.video.videoHeight || PERFORMANCE.cameraHeight;
  inferenceCanvas.width = PERFORMANCE.inferenceWidth;
  inferenceCanvas.height = Math.max(1, Math.round((videoHeight / videoWidth) * PERFORMANCE.inferenceWidth));
}

function detectFace(now) {
  state.lastDetectionAt = now;
  inferenceContext.drawImage(ui.video, 0, 0, inferenceCanvas.width, inferenceCanvas.height);
  const startedAt = performance.now();

  try {
    const result = state.landmarker.detectForVideo(inferenceCanvas, now);
    const elapsed = performance.now() - startedAt;
    state.metrics.inferenceMs = Math.round(elapsed * 10) / 10;
    const budgetedInterval = clamp(elapsed * 4, PERFORMANCE.minInferenceInterval, PERFORMANCE.maxInferenceInterval);
    state.inferenceInterval = lerp(state.inferenceInterval, budgetedInterval, 0.2);
    const landmarks = result.faceLandmarks?.[0];
    const blendshapes = result.faceBlendshapes?.[0]?.categories;

    if (landmarks) {
      updateHeadCollider(landmarks, now);
      updateExpression(blendshapes ? getSmileScore(blendshapes) : 0, now);
    } else {
      state.head.alpha = lerp(state.head.alpha, 0, 0.2);
      if (state.head.alpha < 0.04) state.head.valid = false;
      state.rainTarget = 0;
      state.isSmiling = false;
      state.smoothedSmile = lerp(state.smoothedSmile, 0, 0.3);
      ui.smileFill.style.width = `${Math.round(state.smoothedSmile * 100)}%`;
      ui.signalLabel.textContent = "FINDING FACE";
    }
  } catch (error) {
    console.warn("Face detection frame skipped", error);
  }
}

function detectVision(now) {
  if (!state.landmarker || ui.video.readyState < 2) return;
  if (ui.video.currentTime === state.lastVideoTime || now - state.lastVisionAt < PERFORMANCE.minVisionGap) return;

  const faceDue = now - state.lastDetectionAt >= state.inferenceInterval;
  if (!faceDue) return;
  state.lastVideoTime = ui.video.currentTime;
  state.lastVisionAt = now;
  detectFace(now);
}

async function createVisionTask(Task, fileset, options, label) {
  try {
    return await Task.createFromOptions(fileset, options);
  } catch (gpuError) {
    console.warn(`${label} GPU unavailable; falling back to CPU`, gpuError);
    return Task.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "CPU" },
    });
  }
}

async function initVision() {
  if (state.landmarker) return [state.landmarker];
  if (state.visionPromise) return state.visionPromise;
  state.visionPromise = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
    const faceOptions = {
      baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    };
    state.landmarker = await createVisionTask(FaceLandmarker, fileset, faceOptions, "Face tracking");
    return [state.landmarker];
  })().catch((error) => {
    state.visionPromise = null;
    throw error;
  });
  return state.visionPromise;
}

function waitForVideoMetadata() {
  if (ui.video.readyState >= 1 && ui.video.videoWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Camera timed out")), 10000);
    ui.video.addEventListener("loadedmetadata", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

async function startCamera() {
  stopCamera();
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: PERFORMANCE.cameraWidth, max: 960 },
      height: { ideal: PERFORMANCE.cameraHeight, max: 720 },
      frameRate: { ideal: PERFORMANCE.cameraFps, max: PERFORMANCE.cameraFps },
    },
  });
  ui.video.srcObject = state.stream;
  await waitForVideoMetadata();
  await ui.video.play();
  prepareInferenceCanvases();
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  ui.video.srcObject = null;
}

function closeExperience() {
  state.running = false;
  stopCamera();

  state.lastVideoTime = -1;
  state.lastVisionAt = 0;
  state.lastDetectionAt = 0;
  state.lastPoseAt = 0;
  state.nextVisionTask = "face";
  state.smoothedSmile = 0;
  state.lastExpressionAt = 0;
  state.silhouette = null;
  state.collisionMask = null;
  state.collisionHead = null;
  state.isSmiling = false;
  state.laughArmed = true;
  state.laughAboveSince = 0;
  state.lastIgnitionAt = -10000;
  state.rainAmount = 0;
  state.rainTarget = 0;
  state.rainSuppressedUntil = 0;
  state.expressionMode = "neutral";
  Object.assign(state.head, { valid: false, cx: 0, cy: 0, rx: 0, ry: 0, vx: 0, vy: 0, alpha: 0, updatedAt: 0 });
  Object.assign(state.body, {
    valid: false,
    alpha: 0,
    scale: 90,
    points: [],
    poseColliders: [],
    fallbackColliders: [],
    colliders: [],
    poseMisses: 0,
    shoulderMisses: 0,
    shoulderLastSeenAt: 0,
    shoulderSource: "none",
    updatedAt: 0,
  });

  rockets.length = 0;
  fireworkParticles.length = 0;
  collisionSparks.length = 0;
  burstFlashes.length = 0;
  rainImpacts.length = 0;
  rain.forEach((drop) => { drop.active = false; });
  state.metrics.particleCount = 0;

  clearTimeout(calloutTimer);
  clearTimeout(toastTimer);
  ui.errorPanel.hidden = true;
  ui.app.dataset.state = "idle";
  delete ui.app.dataset.metrics;
  ui.signalLabel.textContent = "CAMERA OFF";
  ui.smileFill.style.width = "0%";
  ui.smileCallout.classList.remove("ignited");
  ui.smileCallout.querySelector("span").textContent = "EXPRESSION WEATHER";
  ui.smileCallout.querySelector("strong").textContent = "READY";
  state.calloutKey = "EXPRESSION WEATHER|READY|false";
  ui.toast.classList.remove("visible");
  ui.toast.textContent = "";
  ui.flash.classList.remove("active");
  ui.startButton.disabled = false;
  ui.startButton.querySelector("span").textContent = "OPEN CAMERA";
  ctx.clearRect(0, 0, state.width, state.height);

  sound.pause();
}

function friendlyCameraError(error) {
  if (!window.isSecureContext) return "Camera access needs HTTPS or localhost.";
  if (error?.name === "NotAllowedError") return "Camera permission was blocked. Allow access in your browser settings.";
  if (error?.name === "NotFoundError") return "No camera was found on this device.";
  if (error?.name === "NotReadableError") return "The camera is being used by another app.";
  return "Camera or face tracking could not start. Please try again.";
}

async function startExperience() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showError(new Error("Camera API unavailable"));
    return;
  }
  ui.errorPanel.hidden = true;
  ui.app.dataset.state = "loading";
  ui.startButton.disabled = true;
  ui.startButton.querySelector("span").textContent = "LOADING VISION...";

  try {
    await sound.unlock().catch(() => {});
    await Promise.all([initVision(), startCamera()]);
    state.running = true;
    state.lastVideoTime = -1;
    state.lastVisionAt = 0;
    state.lastDetectionAt = 0;
    state.lastPoseAt = 0;
    state.nextVisionTask = "face";
    state.lastRenderAt = performance.now();
    ui.app.dataset.state = "live";
    ui.startButton.disabled = false;
    ui.startButton.querySelector("span").textContent = "OPEN CAMERA";
    showToast("SMILE -> RAIN  /  LAUGH -> FIREWORKS", 4200);
  } catch (error) {
    console.error(error);
    showError(error);
  }
}

function showError(error) {
  state.running = false;
  stopCamera();
  sound.pause();
  ui.app.dataset.state = "error";
  ui.errorMessage.textContent = friendlyCameraError(error);
  ui.errorPanel.hidden = false;
  ui.startButton.disabled = false;
  ui.startButton.querySelector("span").textContent = "OPEN CAMERA";
}

function showToast(message, duration = 1400) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("visible"), duration);
}

function toggleSound() {
  sound.setEnabled(!sound.enabled);
  ui.soundButton.dataset.active = String(sound.enabled);
  ui.soundButton.setAttribute("aria-label", sound.enabled ? "Mute sound" : "Unmute sound");
  ui.soundButton.innerHTML = sound.enabled
    ? '<i data-lucide="volume-2" aria-hidden="true"></i>'
    : '<i data-lucide="volume-x" aria-hidden="true"></i>';
  createIcons({ icons: { Volume2, VolumeX }, root: ui.soundButton });
  if (sound.enabled) sound.unlock().catch(() => {});
}

function capturePhoto() {
  if (!state.running || !ui.video.videoWidth) return;
  const output = document.createElement("canvas");
  output.width = state.width;
  output.height = state.height;
  const outputContext = output.getContext("2d");
  const videoWidth = ui.video.videoWidth;
  const videoHeight = ui.video.videoHeight;
  const coverScale = Math.max(state.width / videoWidth, state.height / videoHeight);
  const drawWidth = videoWidth * coverScale;
  const drawHeight = videoHeight * coverScale;
  const offsetX = (state.width - drawWidth) / 2;
  const offsetY = (state.height - drawHeight) / 2;

  outputContext.save();
  outputContext.translate(state.width, 0);
  outputContext.scale(-1, 1);
  outputContext.drawImage(ui.video, offsetX, offsetY, drawWidth, drawHeight);
  outputContext.restore();
  outputContext.drawImage(ui.canvas, 0, 0, state.width, state.height);
  outputContext.fillStyle = "#fff";
  outputContext.font = "900 16px Arial";
  outputContext.fillText("SMILE/LIVE", 22, 38);
  outputContext.fillStyle = "#fe2c55";
  outputContext.fillRect(22, 47, 36, 3);
  outputContext.fillStyle = "#25f4ee";
  outputContext.fillRect(58, 47, 36, 3);

  ui.flash.classList.remove("active");
  requestAnimationFrame(() => ui.flash.classList.add("active"));
  output.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `smile-live-${Date.now()}.png`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("PHOTO SAVED");
  }, "image/png");
}

ui.startButton.addEventListener("click", startExperience);
ui.retryButton.addEventListener("click", startExperience);
ui.closeButton.addEventListener("click", closeExperience);
ui.soundButton.addEventListener("click", toggleSound);
ui.captureButton.addEventListener("click", capturePhoto);
window.addEventListener("resize", resizeCanvas, { passive: true });
window.addEventListener("beforeunload", stopCamera);
document.addEventListener("visibilitychange", () => {
  state.pageVisible = !document.hidden;
  state.lastRenderAt = performance.now();
  if (state.stream) state.stream.getVideoTracks().forEach((track) => { track.enabled = state.pageVisible; });
  if (!state.pageVisible) sound.pause();
  else if (state.running) sound.unlock().catch(() => {});
});

Object.defineProperty(window, "__SMILE_LIVE_METRICS__", {
  get: () => ({
    ...state.metrics,
    inferenceInterval: Math.round(state.inferenceInterval),
    poseInterval: Math.round(state.poseInterval),
    rainAmount: Math.round(state.rainAmount * 100) / 100,
    smileScore: Math.round(state.smoothedSmile * 100) / 100,
    expressionMode: state.expressionMode,
    bodyTracked: false,
    bodyColliderCount: 0,
    bodyColliderParts: [],
    shoulderSource: "disabled",
    collisionSource: state.collisionHead ? "face" : "none",
    segmentationEnabled: false,
    maskAgeMs: state.silhouette ? Math.round(performance.now() - state.silhouette.updatedAt) : null,
    shoulderCollider: state.body.colliders.find((collider) => collider.part.includes("shoulder")) ?? null,
  }),
});

resizeCanvas();
requestAnimationFrame(drawScene);

// Warm the model after the first paint so the camera button can reuse the initialized task.
const warmVision = () => initVision().catch(() => {});
if ("requestIdleCallback" in window) window.requestIdleCallback(warmVision, { timeout: 2500 });
else window.setTimeout(warmVision, 800);

const qaVariant = new URLSearchParams(window.location.search).get("demo");
const qaMode = import.meta.env.DEV && Boolean(qaVariant);

if (qaMode) {
  window.__SMILE_LIVE_QA__ = {
    expression: updateExpression,
    ignite: () => igniteSky(performance.now()),
    snapshot: () => ({ rain: rain.filter((drop) => drop.active).length, fireworks: fireworkParticles.length, sparks: collisionSparks.length, rockets: rockets.length }),
  };
  const qaCenterX = state.width / 2;
  const qaShoulderY = state.height * 0.42;
  const qaHipY = state.height * 0.64;
  const qaKneeY = state.height * 0.8;
  const qaAnkleY = state.height * 0.95;
  const qaShoulderHalf = Math.min(92, state.width * 0.16);
  const qaHipHalf = qaShoulderHalf * 0.62;
  const qaCapsule = (part, ax, ay, bx, by, radius) => ({
    part,
    ax,
    ay,
    bx,
    by,
    baseAx: ax,
    baseAy: ay,
    baseBx: bx,
    baseBy: by,
    radius,
    vx: 0,
    vy: 0,
  });
  state.head = {
    valid: true,
    cx: qaCenterX,
    cy: state.height * 0.27,
    rx: Math.min(72, state.width * 0.12),
    ry: Math.min(92, state.height * 0.12),
    vx: 0,
    vy: 0,
    alpha: 1,
    updatedAt: performance.now(),
  };
  updateFallbackBodyColliders();
  if (qaVariant !== "shoulder") {
    state.body.poseColliders = [
      qaCapsule("torso", qaCenterX, qaShoulderY, qaCenterX, qaHipY, qaShoulderHalf * 0.68),
      qaCapsule("shoulders", qaCenterX - qaShoulderHalf, qaShoulderY, qaCenterX + qaShoulderHalf, qaShoulderY, 15),
      qaCapsule("left-shoulder-pad", qaCenterX - qaShoulderHalf, qaShoulderY, qaCenterX - qaShoulderHalf, qaShoulderY, 22),
      qaCapsule("right-shoulder-pad", qaCenterX + qaShoulderHalf, qaShoulderY, qaCenterX + qaShoulderHalf, qaShoulderY, 22),
      qaCapsule("left-upper-arm", qaCenterX - qaShoulderHalf, qaShoulderY, qaCenterX - qaShoulderHalf * 1.35, state.height * 0.56, 14),
      qaCapsule("left-forearm", qaCenterX - qaShoulderHalf * 1.35, state.height * 0.56, qaCenterX - qaShoulderHalf * 1.5, state.height * 0.69, 12),
      qaCapsule("left-hand", qaCenterX - qaShoulderHalf * 1.5, state.height * 0.69, qaCenterX - qaShoulderHalf * 1.52, state.height * 0.74, 9),
      qaCapsule("right-upper-arm", qaCenterX + qaShoulderHalf, qaShoulderY, qaCenterX + qaShoulderHalf * 1.35, state.height * 0.56, 14),
      qaCapsule("right-forearm", qaCenterX + qaShoulderHalf * 1.35, state.height * 0.56, qaCenterX + qaShoulderHalf * 1.5, state.height * 0.69, 12),
      qaCapsule("right-hand", qaCenterX + qaShoulderHalf * 1.5, state.height * 0.69, qaCenterX + qaShoulderHalf * 1.52, state.height * 0.74, 9),
      qaCapsule("left-thigh", qaCenterX - qaHipHalf, qaHipY, qaCenterX - qaHipHalf * 1.08, qaKneeY, 19),
      qaCapsule("left-calf", qaCenterX - qaHipHalf * 1.08, qaKneeY, qaCenterX - qaHipHalf * 1.15, qaAnkleY, 15),
      qaCapsule("left-foot", qaCenterX - qaHipHalf * 1.15, qaAnkleY, qaCenterX - qaHipHalf * 1.58, qaAnkleY + 8, 10),
      qaCapsule("right-thigh", qaCenterX + qaHipHalf, qaHipY, qaCenterX + qaHipHalf * 1.08, qaKneeY, 19),
      qaCapsule("right-calf", qaCenterX + qaHipHalf * 1.08, qaKneeY, qaCenterX + qaHipHalf * 1.15, qaAnkleY, 15),
      qaCapsule("right-foot", qaCenterX + qaHipHalf * 1.15, qaAnkleY, qaCenterX + qaHipHalf * 1.58, qaAnkleY + 8, 10),
    ];
    state.body.shoulderMisses = 0;
    state.body.shoulderLastSeenAt = performance.now();
    state.body.fallbackColliders.length = 0;
    state.body.alpha = 1;
    refreshBodyColliders();
    if (qaVariant === "moving-shoulders") {
      const startedAt = performance.now();
      window.setInterval(() => {
        const elapsed = (performance.now() - startedAt) / 1000;
        const offsetX = Math.sin(elapsed * 1.7) * Math.min(150, state.width * 0.15);
        const offsetY = Math.sin(elapsed * 2.3) * 54;
        const shoulder = state.body.poseColliders.find((collider) => collider.part === "shoulders");
        if (!shoulder) return;
        shoulder.ax = qaCenterX - qaShoulderHalf + offsetX;
        shoulder.bx = qaCenterX + qaShoulderHalf + offsetX;
        shoulder.ay = qaShoulderY + offsetY;
        shoulder.by = qaShoulderY + offsetY;
        shoulder.baseAx = shoulder.ax;
        shoulder.baseBx = shoulder.bx;
        shoulder.baseAy = shoulder.ay;
        shoulder.baseBy = shoulder.by;
        shoulder.vx = Math.cos(elapsed * 1.7) * Math.min(150, state.width * 0.15) * 1.7;
        shoulder.vy = Math.cos(elapsed * 2.3) * 54 * 2.3;
        for (const pad of state.body.poseColliders.filter((collider) => collider.part.endsWith("shoulder-pad"))) {
          const isLeft = pad.part.startsWith("left");
          const x = (isLeft ? shoulder.ax : shoulder.bx);
          pad.ax = x;
          pad.bx = x;
          pad.ay = shoulder.ay;
          pad.by = shoulder.by;
          pad.baseAx = x;
          pad.baseBx = x;
          pad.baseAy = shoulder.ay;
          pad.baseBy = shoulder.by;
          pad.vx = shoulder.vx;
          pad.vy = shoulder.vy;
        }
        state.body.shoulderLastSeenAt = performance.now();
        ui.app.dataset.qaShoulder = [shoulder.ax, shoulder.ay, shoulder.bx, shoulder.by].map(Math.round).join(",");
        refreshBodyColliders();
      }, 50);
    }
  }
  state.expressionMode = "rain";
  state.rainTarget = 0.78;
  ui.app.dataset.state = "live";
  ui.signalLabel.textContent = "VISUAL QA";
  setCallout("SMILE DETECTED", "RAINING");
  if (qaVariant !== "rain" && qaVariant !== "shoulder") {
    window.setTimeout(() => igniteSky(performance.now()), 900);
    const qaLoop = window.setInterval(() => igniteSky(performance.now()), 4200);
    window.setTimeout(() => {
      clearInterval(qaLoop);
      state.rainTarget = 0;
    }, 30000);
  }
}
