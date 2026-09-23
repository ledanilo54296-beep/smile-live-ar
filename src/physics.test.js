import test from "node:test";
import assert from "node:assert/strict";
import { reflectVelocity, segmentCapsuleIntersection, segmentEllipseIntersection } from "./physics.js";

const head = { cx: 100, cy: 100, rx: 50, ry: 30 };

test("detects a fast particle crossing the entire head between frames", () => {
  const hit = segmentEllipseIntersection(100, 20, 100, 180, head);
  assert.ok(hit);
  assert.ok(Math.abs(hit.y - 70) < 0.001);
  assert.ok(Math.abs(hit.normalX) < 0.001);
  assert.ok(hit.normalY < -0.999);
});

test("rejects a segment that misses the head", () => {
  assert.equal(segmentEllipseIntersection(10, 20, 10, 180, head), null);
});

test("reflects downward motion upward at the top of the head", () => {
  const result = reflectVelocity(20, 200, 0, -1, 0.6, 0.9);
  assert.equal(result.vx, 18);
  assert.equal(result.vy, -120);
});

const limb = { ax: 100, ay: 60, bx: 100, by: 140, radius: 20 };

test("detects a fast particle crossing the middle of a limb capsule", () => {
  const hit = segmentCapsuleIntersection(0, 100, 200, 100, limb);
  assert.ok(hit);
  assert.ok(Math.abs(hit.x - 80) < 0.001);
  assert.ok(hit.normalX < -0.999);
  assert.ok(Math.abs(hit.normalY) < 0.001);
});

test("detects a fast particle crossing a limb end cap", () => {
  const hit = segmentCapsuleIntersection(100, 0, 100, 200, limb);
  assert.ok(hit);
  assert.ok(Math.abs(hit.y - 40) < 0.001);
  assert.ok(hit.normalY < -0.999);
});

test("rejects a segment that misses a limb capsule", () => {
  assert.equal(segmentCapsuleIntersection(130, 0, 130, 200, limb), null);
});

test("detects a vertical rain drop hitting a horizontal shoulder capsule", () => {
  const shoulders = { ax: 40, ay: 80, bx: 160, by: 80, radius: 18 };
  const hit = segmentCapsuleIntersection(100, 0, 100, 160, shoulders);
  assert.ok(hit);
  assert.ok(Math.abs(hit.y - 62) < 0.001);
  assert.ok(hit.normalY < -0.999);
  const reflected = reflectVelocity(-40, 680, hit.normalX, hit.normalY, 0.48, 0.78);
  assert.ok(reflected.vy < 0);
});
