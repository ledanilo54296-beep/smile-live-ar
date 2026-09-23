import test from "node:test";
import assert from "node:assert/strict";
import { classifyExpression, smoothSmile } from "./expression.js";

test("neutral expression has no weather effect", () => {
  assert.deepEqual(classifyExpression(0.12, false), { mode: "neutral", isSmiling: false });
});

test("a smile produces rain without fireworks", () => {
  assert.deepEqual(classifyExpression(0.42, false), { mode: "rain", isSmiling: true });
});

test("a laugh produces fireworks", () => {
  assert.deepEqual(classifyExpression(0.78, true), { mode: "laugh", isSmiling: true });
});

test("rain hysteresis prevents threshold flicker", () => {
  assert.deepEqual(classifyExpression(0.15, true), { mode: "rain", isSmiling: true });
  assert.deepEqual(classifyExpression(0.15, false), { mode: "neutral", isSmiling: false });
  assert.deepEqual(classifyExpression(0.11, true), { mode: "neutral", isSmiling: false });
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
  assert.equal(classifyExpression(smoothSmile(0, 0.25, 100), false).mode, "neutral");
});
