import test from "node:test";
import assert from "node:assert/strict";
import { fitHeadEllipse, reflectVelocity, segmentCapsuleIntersection, segmentEllipseIntersection } from "./physics.js";

test("head boundary reaches the crown, not the forehead, without an outer padding zone", () => {
  const left = { x: 50, y: 120 }, right = { x: 150, y: 120 };
  const brow = { x: 100, y: 100 }, chin = { x: 100, y: 200 };
  const fitted = fitHeadEllipse(left, right, brow, chin);
  assert.deepEqual(fitted, fitHeadEllipse(right, left, brow, chin));
  assert.equal(segmentEllipseIntersection(100, -50, 100, 10, fitted), null, 'Rain above the crown must not bounce in empty space');
  const hit = segmentEllipseIntersection(100, 10, 100, 80, fitted);
  assert.ok(hit && Math.abs(hit.y - 15) < 0.001, 'Rain reaches the crown before bouncing');
});

test("tilting the head rotates both the collision boundary and its reflection normal", () => {
  const angle = 0.5;
  const rotate = ({ x, y }) => ({ x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) });
  const points = [{ x: 50, y: 120 }, { x: 150, y: 120 }, { x: 100, y: 100 }, { x: 100, y: 200 }];
  const upright = fitHeadEllipse(...points), tilted = fitHeadEllipse(...points.map(rotate));
  assert.ok(Math.abs(tilted.rx - upright.rx) < 1e-6);
  assert.ok(Math.abs(tilted.ry - upright.ry) < 1e-6);
  const start = rotate({ x: 100, y: 0 }), end = rotate({ x: 100, y: 50 });
  const hit = segmentEllipseIntersection(start.x, start.y, end.x, end.y, tilted);
  const expected = rotate({ x: 100, y: 15 });
  assert.ok(hit && Math.hypot(hit.x - expected.x, hit.y - expected.y) < 1e-6);
  assert.ok(Math.abs(hit.normalX - Math.sin(angle)) < 1e-6);
});

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
