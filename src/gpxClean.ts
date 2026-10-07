import type { Split, TrackPt } from './session';

// GPS positions jitter by a few metres. Strava adds up every hop between exported points, so raw jitter makes
// the distance too long (and the pace look too fast). The export therefore uses a smoothed copy of the route:
// heavy smoothing when moving slowly (jitter is large compared with the step), light when running fast
// (so corners are not cut). The app's own saved run is left untouched.
const hav = (a: TrackPt, b: TrackPt) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export const cleanTrack = (track: TrackPt[]): TrackPt[] => {
  const n = track.length;
  if (n < 3) return track;
  const win = (i: number) => {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    const dt = (track[b].t - track[a].t) / 1000;
    const v = dt > 0 ? hav(track[a], track[b]) / dt : 0; // local speed, m/s
    return v >= 2.5 ? 1 : v >= 1.2 ? 2 : 3;
  };
  return track.map((p, i) => {
    const k = win(i);
    const a = Math.max(0, i - k), b = Math.min(n - 1, i + k);
    let la = 0, lo = 0;
    for (let j = a; j <= b; j++) {
      la += track[j].lat;
      lo += track[j].lon;
    }
    const m = b - a + 1;
    return { ...p, lat: la / m, lon: lo / m };
  });
};

// ---- Moving time the way Strava computes it from an uploaded file ------------------------------------------
// Strava looks only at the exported points: time spent slower than a speed cut-off counts as rest once it lasts
// longer than 15 s. On a real 5.4 km ride, a cut-off of 1.0 m/s on the cleaned route reproduced Strava's
// moving time to the second. Computing the saved pace from the same points that get exported keeps the app's
// History pace and Strava's pace in agreement (the live screen is only an estimate while you run).
export const STRAVA_MOVING_MS = 1.0;
const REST_AFTER_S = 15;

export const stravaMovingSec = (track: TrackPt[]): number | null => {
  const t = cleanTrack(track);
  if (t.length < 3) return null;
  let moving = 0;
  let slow = 0;
  for (let i = 1; i < t.length; i++) {
    const dt = (t[i].t - t[i - 1].t) / 1000;
    if (dt <= 0) continue;
    if (hav(t[i - 1], t[i]) / dt >= STRAVA_MOVING_MS) {
      if (slow > 0 && slow <= REST_AFTER_S) moving += slow; // a short slow patch still counts as moving
      slow = 0;
      moving += dt;
    } else {
      slow += dt;
    }
  }
  if (slow > 0 && slow <= REST_AFTER_S) moving += slow;
  return moving;
};

// Per-km (or per-mile) splits computed the same way as stravaMovingSec, from the cleaned/exported route, so a
// run's splits always sum to the same moving time as its saved average pace (and match what Strava will show).
export const computeSplits = (track: TrackPt[], splitMeters: number): Split[] => {
  const t = cleanTrack(track);
  if (t.length < 2) return [];
  const splits: Split[] = [];
  let dist = 0, moving = 0, slow = 0, lastSplitSec = 0;
  const movingTotal = () => moving + (slow > 0 && slow <= REST_AFTER_S ? slow : 0);
  for (let i = 1; i < t.length; i++) {
    const dt = (t[i].t - t[i - 1].t) / 1000;
    if (dt <= 0) continue;
    const d = hav(t[i - 1], t[i]);
    const prevDist = dist;
    dist += d;
    const movBefore = movingTotal();
    if (d / dt >= STRAVA_MOVING_MS) {
      if (slow > 0 && slow <= REST_AFTER_S) moving += slow;
      slow = 0;
      moving += dt;
    } else {
      slow += dt;
    }
    const movAfter = movingTotal();
    while (dist >= (splits.length + 1) * splitMeters && dist > prevDist) {
      const km = splits.length + 1;
      const frac = Math.min(1, Math.max(0, (km * splitMeters - prevDist) / (dist - prevDist)));
      const totalSec = Math.max(lastSplitSec, movBefore + frac * Math.max(0, movAfter - movBefore));
      splits.push({ km, splitSec: Math.max(1, totalSec - lastSplitSec), totalSec });
      lastSplitSec = totalSec;
    }
  }
  return splits;
};
