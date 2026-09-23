export const EXPRESSION_THRESHOLDS = {
  rainOn: 0.18,
  rainOff: 0.12,
  laughOn: 0.60,
};

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
