import test from "node:test";
import assert from "node:assert/strict";
import { findTrackedPersonCollision } from "./person-collision.js";
import { reflectVelocity } from "./physics.js";

const head = { cx: 100, cy: 60, rx: 25, ry: 30, vx: 0, vy: 0 };
const shoulder = { part: "shoulders", ax: 40, ay: 110, bx: 160, by: 110, radius: 10, vx: 0, vy: 0 };
const emptyMask = { data: new Float32Array(10000), width: 100, height: 100, sx: 200, sy: 200, ox: 0, oy: 0 };

test("an empty segmentation result cannot switch off tracked head collisions", () => {
  const hit = findTrackedPersonCollision(100, 0, 100, 80, emptyMask, head, [shoulder]);
  assert.equal(hit.source, "face");
  assert.equal(hit.y, 30);
});

test("rain still hits a tracked shoulder when segmentation omits it", () => {
  const hit = findTrackedPersonCollision(45, 0, 45, 180, emptyMask, head, [shoulder]);
  assert.equal(hit.part, "shoulders");
  assert.equal(hit.source, "pose");
  assert.equal(hit.y, 100);
  assert.ok(reflectVelocity(-30, 680, hit.normalX, hit.normalY, 0.32).vy < -200);
});

test("an observed silhouette surface remains preferred over approximate geometry", () => {
  const mask = { ...emptyMask, data: Float32Array.from({ length: 10000 }, (_, i) => Math.floor(i / 100) >= 55 ? 1 : 0) };
  const hit = findTrackedPersonCollision(45, 0, 45, 180, mask, head, [shoulder]);
  assert.equal(hit.source, "silhouette");
  assert.ok(Math.abs(hit.y - 110) < 1);
});

test("moving shoulders update collision positions without a face-derived body", () => {
  const moved = { ...shoulder, ay: 150, by: 150 };
  assert.equal(findTrackedPersonCollision(45, 90, 45, 120, emptyMask, null, [moved]), null);
  assert.equal(findTrackedPersonCollision(45, 120, 45, 180, emptyMask, null, [moved]).y, 140);
  assert.equal(findTrackedPersonCollision(45, 0, 45, 180, emptyMask, null, []), null);
});

test("fast firework sparks hit the arm even if its mask is missing", () => {
  const arm = { part: "left-forearm", ax: 30, ay: 120, bx: 30, by: 190, radius: 8, vx: 25, vy: 0 };
  const hit = findTrackedPersonCollision(0, 160, 200, 160, emptyMask, head, [arm, shoulder]);
  assert.equal(hit.part, "left-forearm");
  assert.equal(hit.vx, 25);
  assert.ok(hit.x > 20 && hit.x < 22);
});

test("specific hand collider wins a near tie against a broad torso collider", () => {
  const torso = { part: "torso", ax: 70, ay: 40, bx: 70, by: 180, radius: 35, vx: 0, vy: 0 };
  const hand = { part: "left-hand-palm", ax: 45, ay: 100, bx: 60, by: 100, radius: 10, vx: 0, vy: 0 };
  const hit = findTrackedPersonCollision(0, 100, 140, 100, emptyMask, null, [torso, hand]);
  assert.equal(hit.part, "left-hand-palm");
  assert.ok(hit.x >= 34 && hit.x <= 40);
});

test("joint motion adds a bounded sweep without changing a stationary hit", () => {
  const movingArm = { part: "left-forearm", ax: 50, ay: 90, bx: 50, by: 150, radius: 5, vx: 300, vy: 0 };
  const stationary = { ...movingArm, vx: 0 };
  const movingHit = findTrackedPersonCollision(0, 120, 100, 120, emptyMask, null, [movingArm]);
  const stationaryHit = findTrackedPersonCollision(0, 120, 100, 120, emptyMask, null, [stationary]);
  assert.ok(movingHit);
  assert.ok(stationaryHit);
  assert.ok(movingHit.x < stationaryHit.x);
  assert.ok(stationaryHit.x >= 44 && stationaryHit.x <= 46);
});
