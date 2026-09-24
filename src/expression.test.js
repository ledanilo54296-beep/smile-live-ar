import test from "node:test";
import assert from "node:assert/strict";
import { classifyExpression, smoothSmile, smileFromLandmarks } from "./expression.js";

test("neutral expression has no weather effect", () => {
  assert.deepEqual(classifyExpression(0.05, false), { mode: "neutral", isSmiling: false });
});

test("a smile produces rain without fireworks", () => {
  assert.deepEqual(classifyExpression(0.42, false), { mode: "rain", isSmiling: true });
});

test("a laugh produces fireworks", () => {
  assert.deepEqual(classifyExpression(0.78, true), { mode: "laugh", isSmiling: true });
});

test("rain hysteresis prevents threshold flicker", () => {
  assert.deepEqual(classifyExpression(0.08, true), { mode: "rain", isSmiling: true });
  assert.deepEqual(classifyExpression(0.08, false), { mode: "neutral", isSmiling: false });
  assert.deepEqual(classifyExpression(0.05, true), { mode: "neutral", isSmiling: false });
});

test("a gentle smile and a moderate grin no longer need exaggerated expressions", () => {
  assert.equal(classifyExpression(0.2, false).mode, "rain");
  assert.equal(classifyExpression(0.48, true).mode, "rain");
  assert.equal(classifyExpression(0.51, true).mode, "rain");
  assert.equal(classifyExpression(0.58, true).mode, "rain");
  assert.equal(classifyExpression(0.60, true).mode, "laugh");
  assert.equal(classifyExpression(0.62, true).mode, "laugh");
});

test("smile smoothing responds consistently across inference rates", () => {
  let fast = 0;
  let slow = 0;
  for (let i = 0; i < 6; i += 1) fast = smoothSmile(fast, 0.24, 50);
  for (let i = 0; i < 2; i += 1) slow = smoothSmile(slow, 0.24, 150);
  assert.ok(Math.abs(fast - slow) < 0.000001);
  assert.equal(classifyExpression(slow, false).mode, "rain");
  assert.equal(classifyExpression(smoothSmile(0, 0.25, 100), false).mode, "rain");
});

const mouth = (opening) => {
  const points = Array.from({ length: 68 }, () => ({ x: 0.5, y: 0.5 }));
  points[48] = { x: 0.4, y: 0.5 };
  points[54] = { x: 0.6, y: 0.5 };
  points[62] = { x: 0.5, y: 0.5 - opening * 0.1 };
  points[66] = { x: 0.5, y: 0.5 + opening * 0.1 };
  return points;
};

test("a faint closed smile now starts rain without changing the fireworks threshold", () => {
  assert.equal(classifyExpression(smileFromLandmarks(0.3, mouth(0.05)), false).mode, "rain");
  assert.equal(classifyExpression(0.59, true).mode, "rain");
  assert.equal(classifyExpression(0.60, true).mode, "laugh");
});

test("a closed smile produces rain even when smile confidence saturates", () => {
  assert.equal(classifyExpression(smileFromLandmarks(1, mouth(0.05)), false).mode, "rain");
});

test("open smiling mouth triggers fireworks but a non-smiling open mouth does not", () => {
  assert.equal(classifyExpression(smileFromLandmarks(0.95, mouth(0.3)), false).mode, "laugh");
  assert.equal(classifyExpression(smileFromLandmarks(0.05, mouth(0.6)), false).mode, "neutral");
});

test("a natural laugh with moderate confidence does not need an exaggerated open mouth", () => {
  assert.equal(classifyExpression(smileFromLandmarks(0.85, mouth(0.19)), true).mode, "laugh");
  assert.equal(classifyExpression(smileFromLandmarks(1, mouth(0.11)), true).mode, "rain");
});

test("mouth score is unchanged by image aspect ratio or head rotation", () => {
  const points = mouth(0.3);
  const score = smileFromLandmarks(0.9, points);
  const wide = points.map(({ x, y }) => ({ x: x / 2, y }));
  const rotated = points.map(({ x, y }) => ({ x: x * Math.cos(0.5) - y * Math.sin(0.5), y: x * Math.sin(0.5) + y * Math.cos(0.5) }));
  assert.ok(Math.abs(score - smileFromLandmarks(0.9, wide, 2)) < 1e-6);
  assert.ok(Math.abs(score - smileFromLandmarks(0.9, rotated)) < 1e-6);
});
