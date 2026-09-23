const EPSILON = 0.000001;

function segmentCircleIntersection(x0, y0, x1, y1, cx, cy, radius) {
  const startX = x0 - cx;
  const startY = y0 - cy;
  const deltaX = x1 - x0;
  const deltaY = y1 - y0;
  const a = deltaX * deltaX + deltaY * deltaY;
  const c = startX * startX + startY * startY - radius * radius;
  if (a < EPSILON || c <= 0) return null;

  const b = 2 * (startX * deltaX + startY * deltaY);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const near = (-b - root) / (2 * a);
  const far = (-b + root) / (2 * a);
  const t = near >= 0 && near <= 1 ? near : far >= 0 && far <= 1 ? far : null;
  if (t === null) return null;

  const x = x0 + deltaX * t;
  const y = y0 + deltaY * t;
  const normalLength = Math.hypot(x - cx, y - cy) || 1;
  const normalX = (x - cx) / normalLength;
  const normalY = (y - cy) / normalLength;
  if (deltaX * normalX + deltaY * normalY >= 0) return null;
  return { t, x, y, normalX, normalY };
}

export function segmentEllipseIntersection(x0, y0, x1, y1, ellipse) {
  if (!ellipse || ellipse.rx <= 0 || ellipse.ry <= 0) return null;

  const startX = (x0 - ellipse.cx) / ellipse.rx;
  const startY = (y0 - ellipse.cy) / ellipse.ry;
  const deltaX = (x1 - x0) / ellipse.rx;
  const deltaY = (y1 - y0) / ellipse.ry;
  const a = deltaX * deltaX + deltaY * deltaY;
  const b = 2 * (startX * deltaX + startY * deltaY);
  const c = startX * startX + startY * startY - 1;

  if (a < EPSILON || c < 0) return null;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const near = (-b - root) / (2 * a);
  const far = (-b + root) / (2 * a);
  const t = near >= 0 && near <= 1 ? near : far >= 0 && far <= 1 ? far : null;
  if (t === null) return null;

  const x = x0 + (x1 - x0) * t;
  const y = y0 + (y1 - y0) * t;
  let normalX = (x - ellipse.cx) / (ellipse.rx * ellipse.rx);
  let normalY = (y - ellipse.cy) / (ellipse.ry * ellipse.ry);
  const length = Math.hypot(normalX, normalY) || 1;
  normalX /= length;
  normalY /= length;

  return { t, x, y, normalX, normalY };
}

export function segmentCapsuleIntersection(x0, y0, x1, y1, capsule) {
  if (!capsule || capsule.radius <= 0) return null;
  const axisX = capsule.bx - capsule.ax;
  const axisY = capsule.by - capsule.ay;
  const axisLength = Math.hypot(axisX, axisY);
  if (axisLength < EPSILON) {
    return segmentCircleIntersection(x0, y0, x1, y1, capsule.ax, capsule.ay, capsule.radius);
  }

  const unitX = axisX / axisLength;
  const unitY = axisY / axisLength;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const relativeX = x0 - capsule.ax;
  const relativeY = y0 - capsule.ay;
  const startAcross = relativeX * perpendicularX + relativeY * perpendicularY;
  const startAlong = relativeX * unitX + relativeY * unitY;
  const nearestAlong = Math.min(axisLength, Math.max(0, startAlong));
  const nearestX = capsule.ax + unitX * nearestAlong;
  const nearestY = capsule.ay + unitY * nearestAlong;
  if (Math.hypot(x0 - nearestX, y0 - nearestY) <= capsule.radius) return null;

  const deltaX = x1 - x0;
  const deltaY = y1 - y0;
  const deltaAcross = deltaX * perpendicularX + deltaY * perpendicularY;
  const deltaAlong = deltaX * unitX + deltaY * unitY;
  const candidates = [];

  if (Math.abs(deltaAcross) > EPSILON) {
    for (const side of [-1, 1]) {
      const t = (side * capsule.radius - startAcross) / deltaAcross;
      const along = startAlong + deltaAlong * t;
      if (t >= 0 && t <= 1 && along >= 0 && along <= axisLength && deltaAcross * side < 0) {
        candidates.push({
          t,
          x: x0 + deltaX * t,
          y: y0 + deltaY * t,
          normalX: perpendicularX * side,
          normalY: perpendicularY * side,
        });
      }
    }
  }

  const startCap = segmentCircleIntersection(x0, y0, x1, y1, capsule.ax, capsule.ay, capsule.radius);
  const endCap = segmentCircleIntersection(x0, y0, x1, y1, capsule.bx, capsule.by, capsule.radius);
  if (startCap) candidates.push(startCap);
  if (endCap) candidates.push(endCap);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0];
}

export function reflectVelocity(vx, vy, normalX, normalY, restitution = 0.62, tangentDamping = 0.9) {
  const normalSpeed = vx * normalX + vy * normalY;
  if (normalSpeed >= 0) return { vx, vy };

  const tangentX = vx - normalSpeed * normalX;
  const tangentY = vy - normalSpeed * normalY;
  return {
    vx: tangentX * tangentDamping - normalSpeed * restitution * normalX,
    vy: tangentY * tangentDamping - normalSpeed * restitution * normalY,
  };
}
