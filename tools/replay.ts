// Replays a run's GPS fixes through the app's real distance / moving-time logic on a computer.
//
//   npx tsx tools/replay.ts <gps-log.csv>     a log saved from the app (run details -> GPS log)
//   npx tsx tools/replay.ts --synthetic       a simulated city run with a known true distance
//   add  --old[=<git ref>]  to also run the logic as it was at that commit (default HEAD) for comparison
//   add  --mix=clean|city|weak|gaps and --seed=<n> to change the simulated GPS conditions
//
// The native/React Native modules session.ts imports are stubbed, so the real code runs unchanged.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'child_process';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import Module from 'module';
import path from 'path';

const noop = () => undefined;
const asyncNoop = async () => undefined;
const storage = { getItem: async () => null, setItem: asyncNoop, removeItem: asyncNoop, multiGet: async () => [], multiSet: asyncNoop, multiRemove: asyncNoop, getAllKeys: async () => [] };
const STUBS: Record<string, any> = {
  'expo-speech': { speak: noop, stop: noop, getAvailableVoicesAsync: async () => [] },
  'expo-audio': { setAudioModeAsync: asyncNoop },
  'expo-haptics': { impactAsync: asyncNoop, ImpactFeedbackStyle: { Medium: 'medium' } },
  'react-native': { Platform: { OS: 'android', Version: 33 } },
  '@react-native-async-storage/async-storage': { __esModule: true, default: storage, ...storage },
  'expo-file-system': {},
  'expo-sharing': {},
  'expo-modules-core': {},
};
const RUNKIT = { requestDuck: noop, abandonDuck: noop, startBeat: noop, stopBeat: noop, showRunNotification: noop, cancelRunNotification: noop };
const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: any[]) {
  if (request.includes('modules/runkit')) return RUNKIT;
  if (STUBS[request]) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};

type Fix = { t: number; lat: number; lon: number; accuracy: number | null; speed: number | null; altitude: number | null; altitudeAccuracy: number | null };

const readLog = (file: string): Fix[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('t_ms'))
    .map((l) => l.split(','))
    .map((c) => ({
      t: +c[0],
      lat: +c[2],
      lon: +c[3],
      accuracy: c[4] === '' ? null : +c[4],
      speed: c[5] === '' ? null : +c[5],
      altitude: c[6] === '' ? null : +c[6],
      altitudeAccuracy: c[7] === '' ? null : +c[7],
    }));

// ---- a simulated city run: winding path, noisy positions, weak-accuracy stretches, GPS gaps, two red lights ----
let seed = Number((process.argv.find((a) => a.startsWith('--seed=')) ?? '--seed=7').slice(7));
const MIX = (process.argv.find((a) => a.startsWith('--mix=')) ?? '--mix=city').slice(6); // clean | city | weak | gaps
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const synthetic = (): { fixes: Fix[]; trueDistM: number; trueMovingS: number } => {
  const M = 111320, lat0 = 14.55, lon0 = 121.0, mlon = M * Math.cos((lat0 * Math.PI) / 180);
  let x = 0, y = 0, heading = 0, trueDist = 0, trueMoving = 0;
  const fixes: Fix[] = [];
  const T0 = Date.UTC(2026, 9, 10, 4, 56, 0);
  let gapUntil = -1;
  const lights = [{ at: 600, len: 45 }, { at: 1500, len: 40 }];
  for (let s = 0; s < 2400; s++) { // 40 minutes, ~7.2 km
    const stopped = lights.some((l) => s >= l.at && s < l.at + l.len);
    const v = stopped ? 0 : 3.0 + 0.4 * Math.sin(s / 31) + 0.15 * gauss();
    heading += (Math.sin(s / 53) * 0.04 + (rnd() < 0.01 ? (rnd() - 0.5) * 1.2 : 0)); // bends and the odd corner
    x += v * Math.sin(heading);
    y += v * Math.cos(heading);
    trueDist += v;
    if (!stopped) trueMoving += 1;
    // GPS gaps: the phone delivers nothing for 8-20 s now and then
    if (s > gapUntil && rnd() < (MIX === 'gaps' ? 0.02 : MIX === 'clean' ? 0 : 0.006)) gapUntil = s + 8 + Math.floor(rnd() * 12);
    if (s <= gapUntil) continue;
    // accuracy mix of a downtown run
    const r = rnd();
    const acc =
      MIX === 'clean' ? 5 + rnd() * 10
      : MIX === 'weak' ? (r < 0.25 ? 8 + rnd() * 10 : r < 0.95 ? 30 + rnd() * 5 : 38 + rnd() * 25) // long stretches between buildings
      : r < 0.55 ? 6 + rnd() * 9 : r < 0.82 ? 16 + rnd() * 13 : r < 0.96 ? 30 + rnd() * 5 : 38 + rnd() * 25;
    const sigma = Math.max(1.5, acc / 3);
    fixes.push({
      t: T0 + s * 1000,
      lat: lat0 + (y + gauss() * sigma) / M,
      lon: lon0 + (x + gauss() * sigma) / mlon,
      accuracy: +acc.toFixed(1),
      speed: Math.max(0, +(v + gauss() * 0.15).toFixed(2)),
      altitude: 12 + gauss() * 4,
      altitudeAccuracy: 8,
    });
  }
  return { fixes, trueDistM: trueDist, trueMovingS: trueMoving };
};

const run = (fixes: Fix[], sessionFile: string, movingFile: string) => {
  let NOW = fixes[0].t - 500;
  Date.now = () => NOW;
  Object.keys(require.cache).forEach((k) => {
    if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
  });
  const S = require(sessionFile);
  const MS = require(movingFile);
  S.startSession();
  for (const f of fixes) {
    NOW = f.t;
    S.addFix(f);
  }
  NOW = fixes[fixes.length - 1].t + 500;
  const st = S.getStats();
  const route = S.getTrack();
  const saved = MS.computeMovingStats(route, st.distanceM, 1000);
  return { distanceM: st.distanceM as number, liveMovingS: st.movingSec as number, savedMovingS: saved.movingSec as number, elevGainM: st.elevGainM as number };
};

const main = () => {
  const args = process.argv.slice(2);
  const root = path.resolve(__dirname, '..', 'src');
  const cur = { s: path.join(root, 'session.ts'), m: path.join(root, 'movingStats.ts') };
  // The older logic is checked out of git into temp files next to the real ones (so its relative
  // imports resolve) and removed again afterwards.
  const oldArg = args.find((a) => a === '--old' || a.startsWith('--old='));
  const old = { s: path.join(root, '__replay_old_session.ts'), m: path.join(root, '__replay_old_movingStats.ts') };
  const withOld = !!oldArg;
  if (oldArg) {
    const ref = oldArg.includes('=') ? oldArg.split('=')[1] : 'HEAD';
    const show = (f: string) => execSync(`git show ${ref}:src/${f}`, { cwd: path.resolve(root, '..'), encoding: 'utf8' });
    writeFileSync(old.s, show('session.ts'));
    writeFileSync(old.m, show('movingStats.ts'));
  }
  const logArg = args.find((a) => !a.startsWith('--'));
  let fixes: Fix[]; let truth: { dist: number; moving: number } | null = null;
  if (args.includes('--synthetic')) {
    const s = synthetic(); fixes = s.fixes; truth = { dist: s.trueDistM, moving: s.trueMovingS };
  } else if (logArg) fixes = readLog(logArg);
  else { console.log('usage: tools/replay.ts <gps-log.csv> | --synthetic [--old]'); return; }

  const weak = fixes.filter((f) => (f.accuracy ?? 0) > 35).length;
  console.log(`${fixes.length} fixes (${weak} weaker than 35 m, dropped by the app)`);
  if (truth) console.log(`truth: ${(truth.dist / 1000).toFixed(3)} km, ${Math.round(truth.moving)} s moving\n`);
  const show = (name: string, r: ReturnType<typeof run>) => {
    const dErr = truth ? ` (${(((r.distanceM - truth.dist) / truth.dist) * 100).toFixed(1)}%)` : '';
    const mErr = truth ? ` (${r.savedMovingS - truth.moving >= 0 ? '+' : ''}${Math.round(r.savedMovingS - truth.moving)} s)` : '';
    const pace = r.savedMovingS / (r.distanceM / 1000);
    console.log(`${name.padEnd(9)} distance ${(r.distanceM / 1000).toFixed(3)} km${dErr}  | moving saved ${Math.round(r.savedMovingS)} s${mErr}  | pace ${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, '0')}/km | elev +${Math.round(r.elevGainM)} m`);
  };
  try {
    if (withOld) show('old logic', run(fixes, old.s, old.m));
    show('new logic', run(fixes, cur.s, cur.m));
  } finally {
    rmSync(old.s, { force: true });
    rmSync(old.m, { force: true });
  }
};
main();
