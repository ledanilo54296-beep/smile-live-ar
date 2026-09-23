import test from "node:test";
import assert from "node:assert/strict";
import { copySilhouette, coverTransform, segmentSilhouetteIntersection } from "./silhouette.js";

function fixture(inside, mirrored = false) {
  const data = Float32Array.from({ length: 100 * 100 }, (_, i) => inside(i % 100, Math.floor(i / 100)) ? 1 : 0);
  return { data, width: 100, height: 100, ...coverTransform(100, 100, 400, 400, mirrored) };
}

test("cover projection aligns portrait crop and front camera mirror", () => {
  const rear = coverTransform(640, 480, 390, 844, false);
  const front = coverTransform(640, 480, 390, 844, true);
  assert.equal(rear.ox + rear.sx * 0.5, 195);
  assert.equal(front.ox + front.sx * 0.5, 195);
  assert.ok(Math.abs(rear.ox + rear.sx * 0.2 + front.ox + front.sx * 0.2 - 390) < 0.0001);
  assert.equal(front.sy, 844);
});

test("fast rain hits a sloping shoulder with an outward surface normal", () => {
  const mask = fixture((x, y) => x > 20 && x < 80 && y > 30 + x * 0.3);
  const hit = segmentSilhouetteIntersection(200, 0, 200, 390, mask);
  assert.ok(hit);
  assert.ok(Math.abs(hit.y - 180) < 6);
  assert.ok(hit.normalY < -0.8);
  assert.ok(hit.normalX > 0.05);
});

test("silhouette preserves empty space under a raised arm", () => {
  const mask = fixture((x, y) => x > 20 && x < 24 && y > 10 && y < 80);
  assert.equal(segmentSilhouetteIntersection(140, 0, 140, 390, mask), null);
  assert.ok(segmentSilhouetteIntersection(0, 160, 390, 160, mask));
});

test("mirrored mask collisions return mirrored coordinates and normals", () => {
  const inside = (x, y) => x > 20 && x < 30 && y > 10 && y < 80;
  const rear = segmentSilhouetteIntersection(0, 160, 400, 160, fixture(inside));
  const front = segmentSilhouetteIntersection(400, 160, 0, 160, fixture(inside, true));
  assert.ok(Math.abs(rear.x + front.x - 400) < 0.01);
  assert.ok(rear.normalX < -0.99 && front.normalX > 0.99);
});

test("particles starting inside a person do not bounce on the exit boundary", () => {
  const mask = fixture((x, y) => x > 20 && x < 80 && y > 20 && y < 80);
  assert.equal(segmentSilhouetteIntersection(200, 200, 200, 400, mask), null);
});

test("mask storage is bounded and reused without retaining MediaPipe resources", () => {
  const source = new Float32Array(256 * 256).fill(0.75);
  source.fill(0.25, source.length / 2);
  const input = { width: 256, height: 256, getAsFloat32Array: () => source };
  const first = copySilhouette(input, null, coverTransform(640, 480, 390, 844, true), 100);
  assert.equal(first.data.length, 160 * 160);
  source.fill(0.25);
  source.fill(0.75, source.length / 2);
  assert.equal(first.data[0], 0.75);
  const second = copySilhouette(input, first, coverTransform(640, 480, 390, 844, true), 200);
  assert.equal(first.data, second.data);
  assert.equal(second.data[0], 0.25);
});

test("invalid GPU readbacks cannot masquerade as a valid body silhouette", () => {
  for (const value of [0, 1, NaN]) {
    const mask = { width: 16, height: 16, getAsFloat32Array: () => new Float32Array(256).fill(value) };
    assert.equal(copySilhouette(mask, null, coverTransform(640, 480, 390, 844, true), 100), null);
  }
});
