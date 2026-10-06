import type { Run } from './history';
import type { TrackPt } from './session';

// Best efforts: the fastest stretch of a given distance found anywhere inside a run's route.
export const EFFORT_DISTANCES = [400, 1000, 2000, 3000, 5000, 10000, 21097, 42195];
export const isEffortDistance = (d: number) => EFFORT_DISTANCES.includes(d);
const LABELS: Record<number, string> = {
  400: '400 m',
  1000: '1 km',
  2000: '2 km',
  3000: '3 km',
  5000: '5 km',
  10000: '10 km',
  21097: 'Half marathon',
  42195: 'Marathon',
};
export const effortLabel = (d: number) => LABELS[d] ?? `${d} m`;

export type Effort = { d: number; s: number }; // distance (m), time (s)
export type Badge = { d: number; rank: 1 | 2 | 3 };

const MAX_GAP_S = 15; // a longer gap between points is a pause / GPS dropout, not running
const MAX_SPEED = 12; // m/s

const hav = (a: TrackPt, b: TrackPt) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export const bestEfforts = (track: TrackPt[]): Effort[] => {
  const n = track.length;
  if (n < 2) return [];
  // Cumulative distance D and active time T; pauses/dropouts add neither.
  const D = [0], T = [0];
  for (let i = 1; i < n; i++) {
    const dt = (track[i].t - track[i - 1].t) / 1000;
    const d = hav(track[i - 1], track[i]);
    const ok = dt > 0 && dt <= MAX_GAP_S && d / dt <= MAX_SPEED;
    D.push(D[i - 1] + (ok ? d : 0));
    T.push(T[i - 1] + (ok ? dt : 0));
  }
  const out: Effort[] = [];
  for (const target of EFFORT_DISTANCES) {
    if (D[n - 1] < target) continue;
    let best = Infinity;
    let i = 0;
    for (let j = 1; j < n; j++) {
      if (D[j] < target) continue;
      const ds = D[j] - target;
      while (i + 1 < j && D[i + 1] <= ds) i++;
      const span = D[i + 1] - D[i];
      const frac = span > 0 ? (ds - D[i]) / span : 0;
      const s = T[j] - (T[i] + frac * (T[i + 1] - T[i]));
      if (s > target / MAX_SPEED && s < best) best = s;
    }
    if (isFinite(best)) out.push({ d: target, s: best });
  }
  return out;
};

// Rank a new run's efforts against earlier runs. 1st counts as soon as there is something to beat;
// 2nd/3rd only once there are at least 3 earlier efforts at that distance (so they mean something).
export const badgesFor = (efforts: Effort[], previous: Run[]): Badge[] =>
  efforts.flatMap((e): Badge[] => {
    const prior = previous.map((r) => r.efforts?.find((x) => x.d === e.d)).filter((x): x is Effort => !!x);
    if (!prior.length) return [];
    const rank = 1 + prior.filter((x) => x.s < e.s).length;
    if (rank === 1) return [{ d: e.d, rank: 1 as const }];
    if (rank <= 3 && prior.length >= 3) return [{ d: e.d, rank: rank as 2 | 3 }];
    return [];
  });

export const badgeText = (b: Badge) =>
  b.rank === 1 ? `Your fastest ${effortLabel(b.d)}!` : `Your ${b.rank === 2 ? '2nd' : '3rd'} fastest ${effortLabel(b.d)}!`;

export type BestEffort = { d: number; s: number; runId: string; startedAt: number };
export const bestOverall = (runs: Run[]): BestEffort[] =>
  EFFORT_DISTANCES.flatMap((d) => {
    let best: BestEffort | null = null;
    for (const r of runs) {
      const e = r.efforts?.find((x) => x.d === d);
      if (e && (!best || e.s < best.s)) best = { d, s: e.s, runId: r.id, startedAt: r.startedAt };
    }
    return best ? [best] : [];
  });
