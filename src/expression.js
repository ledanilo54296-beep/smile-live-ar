export const EXPRESSION_THRESHOLDS = {
  rainOn: 0.10,
  rainOff: 0.06,
  laughOn: 0.48,
};

export function smileFromLandmarks(happy, points, aspect = 1) {
  if (!Number.isFinite(happy) || points.length < 68) return 0;
  const distance = (a, b) => Math.hypot((points[a].x - points[b].x) * aspect, points[a].y - points[b].y);
  const width = distance(48, 54);
  if (width < 0.001) return 0;
  const opening = distance(62, 66) / width;
  const mouthCenter = { x: (points[51].x + points[57].x) / 2, y: (points[51].y + points[57].y) / 2 };
  const corners = { x: (points[48].x + points[54].x) / 2, y: (points[48].y + points[54].y) / 2 };
  const axis = { x: (points[8].x - points[27].x) * aspect, y: points[8].y - points[27].y };
  const axisLength = Math.hypot(axis.x, axis.y) || 1;
  const cornerLift = (((mouthCenter.x - corners.x) * aspect * axis.x + (mouthCenter.y - corners.y) * axis.y) / axisLength) / width;
  const closedSmile = Math.min(0.44, Math.max(0, happy), Math.max(0, cornerLift) * 12 + 0.08);
  // Separate gentle smiles from a natural open smile without requiring an exaggerated jaw opening.
  return Math.max(closedSmile, Math.min(1, Math.max(0, happy)) * (0.44 + 0.56 * Math.min(1, Math.max(0, (opening - 0.12) / 0.18))));
}

export function smoothSmile(previous, score, elapsedMs) {
  const tau = score > previous ? 110 : 180;
  return previous + (score - previous) * (1 - Math.exp(-Math.min(elapsedMs, 250) / tau));
}

export function classifyExpression(score, wasSmiling, thresholds = EXPRESSION_THRESHOLDS) {
  const isSmiling = wasSmiling ? score > thresholds.rainOff : score >= thresholds.rainOn;
  if (score >= thresholds.laughOn) return { mode: "laugh", isSmiling: true };
  if (isSmiling) return { mode: "rain", isSmiling: true };
  return { mode: "neutral", isSmiling: false };
}
