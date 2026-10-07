import AsyncStorage from '@react-native-async-storage/async-storage';
import { badgesFor, bestEfforts } from './efforts';
import { loadRuns, saveRun, Run } from './history';
import { computeMovingStats } from './movingStats';
import { syncNow } from './sync';
import type { TrackPt } from './session';

// A copy of the run being recorded, written every few seconds and again right before saving.
// If the app is killed mid-run, or saving fails, the run is offered back on the next launch.
const KEY = 'runbutan.inprogress';

export type Snapshot = { run: Run; route: TrackPt[] };

export const saveSnapshot = (s: Snapshot) => AsyncStorage.setItem(KEY, JSON.stringify(s));
export const clearSnapshot = () => AsyncStorage.removeItem(KEY);
export const loadSnapshot = async (): Promise<Snapshot | null> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Snapshot) : null;
    return s && s.run && Array.isArray(s.route) ? s : null;
  } catch {
    return null;
  }
};

// Efforts + record badges, then store the run. Used for a normal STOP and for recovery.
//
// movingSec/avgPaceSec/splits are recomputed here from the saved route rather than trusted from
// `base` (the live session's running estimate) — see movingStats.ts for why that estimate can
// drift from what Strava reports for the same run.
export const persistRun = async (base: Run, route: TrackPt[], force = false) => {
  const efforts = bestEfforts(route);
  const badges = badgesFor(efforts, await loadRuns());
  const splitM = base.splitUnit === 'mi' ? 1609.344 : 1000;
  const moving = route.length > 1 ? computeMovingStats(route, base.distanceM, splitM) : null;
  const run: Run = { ...base, ...moving, efforts, badges };
  await saveRun(run, route, force);
  // Best-effort, offline-safe: syncNow() itself no-ops when signed out, and a failed upload here
  // just leaves that run for the next sync to pick up (the save above already succeeded locally).
  syncNow().catch(() => {});
  return run;
};
