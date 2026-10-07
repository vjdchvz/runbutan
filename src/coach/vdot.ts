// Jack Daniels' VDOT model: turns a recent race/best effort into training paces and race predictions.
const vo2 = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v; // v in metres per minute
const pctMax = (tMin: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);

export const vdotFrom = (meters: number, sec: number) => {
  const t = sec / 60;
  return vo2(meters / t) / pctMax(t);
};

const velForVo2 = (x: number) => {
  const a = 0.000104, b = 0.182258, c = -(4.6 + x);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
};
const paceAt = (vdot: number, fraction: number) => 60000 / velForVo2(vdot * fraction); // seconds per km

export type ZonePaces = {
  easy: [number, number]; // [fast end, slow end], sec/km
  marathon: number;
  tempo: number;
  interval: number;
  rep: number;
};

export const zonesFor = (vdot: number): ZonePaces => ({
  easy: [paceAt(vdot, 0.74), paceAt(vdot, 0.62)],
  marathon: paceAt(vdot, 0.8),
  tempo: paceAt(vdot, 0.88),
  interval: paceAt(vdot, 0.975),
  rep: paceAt(vdot, 1.08),
});

// Predicted finishing time (seconds) for a distance, by bisection on the VDOT equation.
export const predictSec = (vdot: number, meters: number) => {
  let lo = meters / 12, hi = meters / 1.2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFrom(meters, mid) > vdot) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
};

export const RACES: { label: string; m: number }[] = [
  { label: '5 km', m: 5000 },
  { label: '10 km', m: 10000 },
  { label: 'Half marathon', m: 21097 },
  { label: 'Marathon', m: 42195 },
  { label: '50 km', m: 50000 },
];
