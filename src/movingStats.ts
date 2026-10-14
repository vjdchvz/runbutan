import { cleanTrack, haversine } from './gpxClean';
import type { Split, TrackPt } from './session';

// Moving time, average pace and km/mi splits — recomputed once at save time from the same
// smoothed route exported to Strava (gpxClean.cleanTrack), using Strava's own moving-time rule,
// so History shows what Strava will show for the same run.
//
// The live numbers in session.ts are an estimate while you're moving (speedEma can lag or wobble
// through stop-and-go), and are good enough for the RUN screen's running display. This is the
// number that gets saved: calibrated against a real Strava upload (an e-bike run whose moving
// time Strava reported as 16:21) to the second, at a plain 1.0 m/s cutoff with the same 15 s
// "a short stop still counts as moving" rest rule Strava uses.
const STRAVA_MOVING_MS = 1.0;
// Strava's own cut-off is ~0.894 m/s (a 30-minute mile). That is for the speed the phone reports,
// which sits near zero while you stand still; positions-only speed needs the calibrated 1.0 above
// because GPS drift makes a standing runner look like they are creeping along.
const DOPPLER_MOVING_MS = 0.9;
const REST_AFTER_MS = 15_000;

export type MovingStats = { movingSec: number; avgPaceSec: number | null; splits: Split[] };

/**
 * `distanceM` is the run's already-correct total distance (from the live GPS/Doppler calc) —
 * passed in rather than re-derived from the cleaned track, whose smoothing can trim a few metres
 * off corners. Average pace divides the recomputed moving time by that same trusted distance.
 * `splitM` is the length of one split in metres (1000 for km, 1609.344 for miles).
 */
export const computeMovingStats = (
  rawTrack: TrackPt[],
  distanceM: number,
  splitM: number,
): MovingStats => {
  const track = cleanTrack(rawTrack);
  if (track.length < 2) return { movingSec: 0, avgPaceSec: null, splits: [] };

  let dist = 0;
  let movingMs = 0;
  let slowMs = 0; // current stretch below the moving speed: only counts as moving if it ends within 15 s
  const movingTotalMs = () => movingMs + (slowMs <= REST_AFTER_MS ? slowMs : 0);
  let splits: Split[] = [];
  let lastSplitTotalSec = 0;

  for (let i = 1; i < track.length; i++) {
    const prev = track[i - 1];
    const cur = track[i];
    const dt = (cur.t - prev.t) / 1000;
    if (dt <= 0) continue;
    const d = haversine(prev, cur);
    // Prefer the phone's own speed when the route has it (runs recorded since the GPS log was added):
    // position differences wobble while you wait at a light and were being counted as running.
    const hasV = cur.v !== undefined;
    const speed = hasV ? (cur.v as number) : d / dt;
    const cutoff = hasV ? DOPPLER_MOVING_MS : STRAVA_MOVING_MS;

    const movBefore = movingTotalMs();
    if (speed >= cutoff) {
      if (slowMs > 0 && slowMs <= REST_AFTER_MS) movingMs += slowMs; // it was only a brief slow patch
      slowMs = 0; // a longer one was rest: dropped
      movingMs += dt * 1000;
    } else {
      slowMs += dt * 1000;
    }
    const movAfter = movingTotalMs();

    const prevDist = dist;
    dist += d;
    // Kilometer/mile splits — interpolate the exact crossing point between the two track points,
    // same approach as session.ts's live split logic. A long gap can cross more than one mark.
    while (dist > prevDist && dist >= (splits.length + 1) * splitM) {
      const km = splits.length + 1;
      const frac = Math.min(1, Math.max(0, (km * splitM - prevDist) / (dist - prevDist)));
      const totalSec = Math.max(lastSplitTotalSec, (movBefore + frac * Math.max(0, movAfter - movBefore)) / 1000);
      splits = [...splits, { km, splitSec: Math.max(1, totalSec - lastSplitTotalSec), totalSec }];
      lastSplitTotalSec = totalSec;
    }
  }

  const movingSec = movingTotalMs() / 1000;
  return {
    movingSec,
    avgPaceSec: distanceM > 10 ? movingSec / (distanceM / 1000) : null,
    splits,
  };
};
