import AsyncStorage from '@react-native-async-storage/async-storage';
import { badgesFor, bestEfforts } from './efforts';
import { loadRuns, loadTrack, Run, updateRun } from './history';
import { computeSplits, stravaMovingSec } from './gpxClean';
import { M_PER_MI } from './units';

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

// One-time: give every older run (that has a saved route) the same Strava-style pace as new runs.
const PACE_FLAG = 'runbutan.pace.v2';
export const migratePace = async () => {
  if (await AsyncStorage.getItem(PACE_FLAG)) return;
  for (const r of await loadRuns()) {
    const track = await loadTrack(r.id);
    const mv = track.length > 2 ? stravaMovingSec(track) : null;
    if (mv !== null && mv > 0 && r.distanceM > 10) {
      await updateRun(r.id, { movingSec: mv, avgPaceSec: mv / (r.distanceM / 1000) });
    }
    await new Promise<void>((res) => setTimeout(res, 120));
  }
  await AsyncStorage.setItem(PACE_FLAG, '1');
};

// One-time: recompute every older run's km/mile splits from its saved route, using the same method as the
// saved pace, so the splits always add up to the run's average pace instead of whatever the live GPS produced.
const SPLITS_FLAG = 'runbutan.splits.v3';
export const migrateSplits = async () => {
  if (await AsyncStorage.getItem(SPLITS_FLAG)) return;
  for (const r of await loadRuns()) {
    const track = await loadTrack(r.id);
    if (track.length > 1) {
      const splitMeters = r.splitUnit === 'mi' ? M_PER_MI : 1000;
      await updateRun(r.id, { splits: computeSplits(track, splitMeters) });
    }
    await new Promise<void>((res) => setTimeout(res, 120));
  }
  await AsyncStorage.setItem(SPLITS_FLAG, '1');
};
