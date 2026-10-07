import AsyncStorage from '@react-native-async-storage/async-storage';
import { badgesFor, bestEfforts } from './efforts';
import { loadRuns, saveRun, Run } from './history';
import { computeSplits, stravaMovingSec } from './gpxClean';
import { M_PER_MI } from './units';
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
export const persistRun = async (base: Run, route: TrackPt[], force = false) => {
  const efforts = bestEfforts(route);
  const badges = badgesFor(efforts, await loadRuns());
  // Pace and splits from the exported (cleaned) route, so History matches what Strava will show for the same
  // run, and the splits always add up to the same moving time as the saved average pace.
  const mv = stravaMovingSec(route);
  const fixed: Partial<Run> =
    mv !== null && mv > 0 && base.distanceM > 10 ? { movingSec: mv, avgPaceSec: mv / (base.distanceM / 1000) } : {};
  const splitMeters = base.splitUnit === 'mi' ? M_PER_MI : 1000;
  const splits = route.length > 1 ? computeSplits(route, splitMeters) : base.splits;
  const run: Run = { ...base, ...fixed, splits, efforts, badges };
  await saveRun(run, route, force);
  return run;
};
