// Geometry helpers ported from skill/templates/runtime.js — anchor/leader xy live in [0,1].
export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

export function pct(n: number): string {
  return `${(clamp01(n) * 100).toFixed(2)}%`;
}
