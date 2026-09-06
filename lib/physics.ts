export const PRESETS = {
  slope: [80, 58, 35, 10],
  valley: [80, 20, 65, 10],
  challenge: [55, 75, 40, 10],
};
export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
// 100 world pixels = 1 metre. Smooth, constrained point-mass model.
export function height(x: number, levels: number[]) {
  const q = clamp(x, 0, 1000),
    i = Math.min(3, Math.floor(q / 300)),
    t = (q - i * 300) / (i === 3 ? 100 : 300);
  return (
    70 +
    2.8 *
      (levels[i] +
        ((levels[Math.min(i + 1, 3)] - levels[i]) *
          (1 - Math.cos(Math.PI * t))) /
          2)
  );
}
export function slope(x: number, l: number[]) {
  return (height(x + 0.25, l) - height(x - 0.25, l)) / 0.5;
}
export type Ball = { x: number; v: number; time: number; won: boolean };
export const freshBall = (): Ball => ({ x: 32, v: 0, time: 0, won: false });
export function step(b: Ball, l: number[], dt: number, f: number): Ball {
  if (b.won) return b;
  const s = slope(b.x, l),
    curve = slope(b.x + 0.5, l) - slope(b.x - 0.5, l),
    a = (-980 * s - s * curve * b.v * b.v) / (1 + s * s) - f * b.v;
  let v = clamp(b.v + a * dt, -1000, 1000),
    x = b.x + v * dt;
  if (x < 3) {
    x = 3;
    v = Math.abs(v) * 0.45;
  }
  if (x > 990) {
    x = 990;
    v = -Math.abs(v) * 0.45;
  }
  return { x, v, time: b.time + dt, won: x >= 945 };
}
export function metrics(b: Ball, l: number[]) {
  const speed = (Math.abs(b.v) * Math.sqrt(1 + slope(b.x, l) ** 2)) / 100,
    h = height(b.x, l) / 100;
  return { speed, h, potential: 9.8 * h, kinetic: 0.5 * speed * speed };
}
export type Landmark = { x: number; y: number; visibility?: number };
export function poseInput(p: Landmark[]) {
  const a = p[11],
    b = p[12];
  if (!a || !b || (a.visibility ?? 0) < 0.65 || (b.visibility ?? 0) < 0.65)
    return null;
  return {
    x: clamp(1 - (a.x + b.x) / 2, 0, 1),
    level: clamp(((0.8 - (a.y + b.y) / 2) / 0.55) * 100, 5, 95),
  };
}
