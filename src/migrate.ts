import AsyncStorage from '@react-native-async-storage/async-storage';
import { badgesFor, bestEfforts } from './efforts';
import { loadRuns, loadTrack, Run, updateRun } from './history';
import { computeMovingStats } from './movingStats';

// One-time: recompute every saved run's best efforts with the current distance list (km-based),
// oldest first so record badges come out right. Runs go one at a time with a pause, so the UI never stalls.
const FLAG = 'runbutan.efforts.v2';

export const migrateEfforts = async () => {
  if (await AsyncStorage.getItem(FLAG)) return;
  const runs = (await loadRuns()).sort((a, b) => a.startedAt - b.startedAt);
  const done: Run[] = [];
  for (const r of runs) {
    const track = await loadTrack(r.id);
    if (track.length > 1) {
      const efforts = bestEfforts(track);
      const badges = badgesFor(efforts, done);
      await updateRun(r.id, { efforts, badges });
      done.push({ ...r, efforts, badges });
    } else {
      done.push(r); // no saved route (older run): nothing to recompute
    }
    await new Promise<void>((res) => setTimeout(res, 120));
  }
  await AsyncStorage.setItem(FLAG, '1');
};

// One-time: recompute every saved run's moving time, average pace and splits from its saved
// route with movingStats.ts's Strava-calibrated rule, so History matches what Strava would show
// for a run saved before this fix. Runs with no saved route (older still) are left untouched —
// there's no route to recompute from.
const MOVING_FLAG = 'runbutan.movingStats.v1';

export const migrateMovingTime = async () => {
  if (await AsyncStorage.getItem(MOVING_FLAG)) return;
  const runs = (await loadRuns()).sort((a, b) => a.startedAt - b.startedAt);
  for (const r of runs) {
    const track = await loadTrack(r.id);
    if (track.length > 1) {
      const splitM = r.splitUnit === 'mi' ? 1609.344 : 1000;
      const moving = computeMovingStats(track, r.distanceM, splitM);
      await updateRun(r.id, moving);
    }
    await new Promise<void>((res) => setTimeout(res, 120));
  }
  await AsyncStorage.setItem(MOVING_FLAG, '1');
};
