import type { TrackPt } from './session';

// GPS positions jitter by a few metres. Strava adds up every hop between exported points, so raw jitter makes
// the distance too long (and the pace look too fast). The export therefore uses a smoothed copy of the route:
// heavy smoothing when moving slowly (jitter is large compared with the step), light when running fast
// (so corners are not cut). The app's own saved run is left untouched.
export const haversine = (a: TrackPt, b: TrackPt) => {
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
    const v = dt > 0 ? haversine(track[a], track[b]) / dt : 0; // local speed, m/s
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
