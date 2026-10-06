import AsyncStorage from '@react-native-async-storage/async-storage';
import { badgesFor, bestEfforts } from './efforts';
import { loadRuns, loadTrack, Run, updateRun } from './history';

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
