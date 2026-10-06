import AsyncStorage from '@react-native-async-storage/async-storage';
import { badgesFor, bestEfforts } from './efforts';
import { loadRuns, saveRun } from './history';
import type { Split, TrackPt } from './session';

// Demo data for screenshots/testing only. Keep SEED_DEMO = false in builds meant for real use.
export const SEED_DEMO = false;

const PLAN = [
  { ago: 60, km: 5.0, pace: 365 }, { ago: 52, km: 6.0, pace: 372 }, { ago: 45, km: 3.5, pace: 345 },
  { ago: 38, km: 12.0, pace: 380 }, { ago: 36, km: 5.0, pace: 371 }, { ago: 25, km: 7.2, pace: 366 },
  { ago: 23, km: 4.0, pace: 358 }, { ago: 17, km: 5.2, pace: 349 }, { ago: 15, km: 10.1, pace: 370 },
  { ago: 11, km: 3.0, pace: 342 }, { ago: 10, km: 6.4, pace: 361 }, { ago: 8, km: 5.0, pace: 355 },
  { ago: 3, km: 8.0, pace: 365 }, { ago: 2, km: 3.2, pace: 350 }, { ago: 0, km: 5.1, pace: 340 },
];

export const seedDemo = async () => {
  const old = (await AsyncStorage.getAllKeys()).filter((k) => /^runbutan\.(runs\.v1|index\.v2|run\.|track\.)/.test(k));
  await AsyncStorage.multiRemove(old);
  const M = 111194.9;
  for (let i = 0; i < PLAN.length; i++) {
    const p = PLAN[i];
    const L = p.km * 1000;
    const start = new Date();
    start.setDate(start.getDate() - p.ago);
    start.setHours(i % 3 === 0 ? 6 : i % 3 === 1 ? 12 : 18, 10 + i, 0, 0);
    const startedAt = start.getTime();
    const lat0 = 14.58 + (i % 5) * 0.004, lon0 = 120.98 + (i % 4) * 0.004;
    const fastKm = 1 + (i % Math.max(1, Math.floor(p.km)));
    const track: TrackPt[] = [];
    let s = 0, k = 0, dist = 0, prev = { lat: lat0, lon: lon0 };
    const splits: Split[] = [];
    let lastSplitT = 0;
    while (s < L) {
      const kmNow = Math.floor(s / 1000) + 1;
      const v = (1000 / p.pace) * (1 + 0.07 * Math.sin(k / 18)) * (kmNow === fastKm ? 1.12 : 1);
      s += v * 2;
      k += 1;
      const th = (2 * Math.PI * s) / L;
      const r = (L / (2 * Math.PI)) * (1 + 0.2 * Math.sin(3 * th));
      const lat = lat0 + (r * (1 - Math.cos(th))) / M;
      const lon = lon0 + (r * Math.sin(th)) / (M * Math.cos((lat0 * Math.PI) / 180));
      dist += Math.hypot((lat - prev.lat) * M, (lon - prev.lon) * M * Math.cos((lat0 * Math.PI) / 180));
      prev = { lat, lon };
      track.push({ t: startedAt + k * 2000, lat, lon });
      if (dist >= (splits.length + 1) * 1000) {
        splits.push({ km: splits.length + 1, splitSec: k * 2 - lastSplitT, totalSec: k * 2 });
        lastSplitT = k * 2;
      }
    }
    const elapsed = k * 2;
    const efforts = bestEfforts(track);
    const badges = badgesFor(efforts, await loadRuns());
    await saveRun(
      {
        id: String(startedAt),
        startedAt,
        distanceM: dist,
        movingSec: elapsed,
        elapsedSec: elapsed + (i % 4) * 20,
        elevGainM: 8 + ((i * 17) % 55),
        avgPaceSec: elapsed / (dist / 1000),
        splits,
        efforts,
        badges,
      },
      track,
    );
  }
};
