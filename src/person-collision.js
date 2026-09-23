import { segmentCapsuleIntersection, segmentEllipseIntersection } from "./physics.js";
import { segmentSilhouetteIntersection } from "./silhouette.js";

const PART_PRIORITY = {
  "left-hand-palm": 5,
  "right-hand-palm": 5,
  "left-hand": 5,
  "right-hand": 5,
  "left-wrist-pad": 4,
  "right-wrist-pad": 4,
  "left-elbow-pad": 4,
  "right-elbow-pad": 4,
  "left-forearm": 3,
  "right-forearm": 3,
  "left-upper-arm": 3,
  "right-upper-arm": 3,
  "left-shoulder-pad": 3,
  "right-shoulder-pad": 3,
  shoulders: 2,
  torso: 1,
};

function priority(part) {
  return PART_PRIORITY[part] ?? 0;
}

function sweptCollider(collider) {
  // Pose is sampled below the render rate. A small velocity-based expansion
  // catches a joint sweeping across a particle between two Pose frames.
  const sweep = Math.min(10, Math.hypot(collider.vx ?? 0, collider.vy ?? 0) * 0.025);
  return sweep ? { ...collider, radius: collider.radius + sweep } : collider;
}

export function findTrackedPersonCollision(x0, y0, x1, y1, mask, head, colliders) {
  const surfaceHit = mask && segmentSilhouetteIntersection(x0, y0, x1, y1, mask);
  if (surfaceHit) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const collider of colliders) {
      const dx = collider.bx - collider.ax;
      const dy = collider.by - collider.ay;
      const t = Math.min(1, Math.max(0, ((surfaceHit.x - collider.ax) * dx + (surfaceHit.y - collider.ay) * dy) / (dx * dx + dy * dy || 1)));
      const distance = Math.hypot(surfaceHit.x - collider.ax - dx * t, surfaceHit.y - collider.ay - dy * t);
      const weightedDistance = distance - priority(collider.part) * 3;
      if (weightedDistance < nearestDistance) {
        nearestDistance = weightedDistance;
        nearest = collider;
      }
    }
    if (head && ((surfaceHit.x - head.cx) / head.rx) ** 2 + ((surfaceHit.y - head.cy) / head.ry) ** 2 < 1.3) {
      return { ...surfaceHit, vx: head.vx, vy: head.vy, part: "head", source: "silhouette" };
    }
    return { ...surfaceHit, vx: nearest?.vx ?? 0, vy: nearest?.vy ?? 0, part: nearest?.part ?? "body", source: "silhouette" };
  }

  // A missing mask boundary must not disable independently tracked joints.
  let earliest = head && segmentEllipseIntersection(x0, y0, x1, y1, head);
  if (earliest) earliest = { ...earliest, vx: head.vx, vy: head.vy, part: "head", source: "face" };
  let earliestPriority = -1;
  for (const collider of colliders) {
    if (collider.part === "pose-head" && head) continue;
    const hit = segmentCapsuleIntersection(x0, y0, x1, y1, sweptCollider(collider));
    const isEarlier = hit && (!earliest || hit.t < earliest.t - 0.045);
    const isSpecificTie = hit && earliest?.source === "pose" && hit.t <= earliest.t + 0.045 && priority(collider.part) > earliestPriority;
    if (hit && (isEarlier || isSpecificTie)) {
      earliest = { ...hit, vx: collider.vx, vy: collider.vy, part: collider.part, source: "pose" };
      earliestPriority = priority(collider.part);
    }
  }
  return earliest || null;
}
