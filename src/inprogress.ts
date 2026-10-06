import AsyncStorage from '@react-native-async-storage/async-storage';
import { badgesFor, bestEfforts } from './efforts';
import { loadRuns, saveRun, Run } from './history';
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
  const run: Run = { ...base, efforts, badges };
  await saveRun(run, route, force);
  return run;
};
