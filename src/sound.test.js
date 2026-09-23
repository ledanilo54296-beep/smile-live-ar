import test from "node:test";
import assert from "node:assert/strict";
import { synthesizeSound } from "./sound.js";

const energy = (data, start, end) => {
  const section = data.subarray(Math.round(start * 24000), Math.round(end * 24000));
  return Math.sqrt(section.reduce((sum, sample) => sum + sample * sample, 0) / section.length);
};

test("cached effects have bounded samples, audible energy and quiet endpoints", () => {
  let bytes = 0;
  for (const kind of ["launch", "burst", "debris", "rain", "drop"]) {
    const data = synthesizeSound(kind);
    assert.ok(data.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 0.9), kind);
    assert.ok(energy(data, 0, data.length / 24000) > 0.002, kind);
    if (kind !== "rain") {
      assert.ok(Math.abs(data[0]) < 0.000001, kind);
      assert.ok(Math.abs(data.at(-1)) < 0.000001, kind);
    } else {
      assert.ok(Math.abs(data[0] - data.at(-1)) < 0.15, "rain seam");
    }
    bytes += data.byteLength * 2;
  }
  assert.ok(bytes < 1500000, "two variants of all effects stay below 1.5 MB decoded");
});

test("launch lasts through ascent and explosion has a short attack with a decaying body", () => {
  const launch = synthesizeSound("launch");
  assert.ok(energy(launch, 0.2, 0.4) > 0.025);
  assert.ok(energy(launch, 0.2, 0.4) > energy(launch, 0.8, 1));
  const burst = synthesizeSound("burst");
  assert.ok(energy(burst, 0, 0.08) > energy(burst, 0.3, 0.5) * 3);
  assert.ok(energy(burst, 0.3, 0.5) > energy(burst, 0.9, 1.1) * 2);
});

test("debris persists after the explosion and fades rather than ending abruptly", () => {
  const debris = synthesizeSound("debris");
  assert.ok(energy(debris, 0.9, 1.3) > 0.002);
  assert.ok(energy(debris, 0.2, 0.7) > energy(debris, 1.8, 2.3) * 2);
  assert.notDeepEqual(debris, synthesizeSound("debris", 71));
});
