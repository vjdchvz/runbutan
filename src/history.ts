import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Badge, Effort } from './efforts';
import type { Split, TrackPt } from './session';

// Storage layout (one key per run, so no single value grows without limit):
//   runbutan.index.v2      JSON array of run ids, newest first
//   runbutan.run.<id>      one Run
//   runbutan.track.<id>    that run's route
// The old single-list key (runbutan.runs.v1) is migrated on first read.
const LEGACY_KEY = 'runbutan.runs.v1';
const INDEX_KEY = 'runbutan.index.v2';
const RUN_PREFIX = 'runbutan.run.';
const runKey = (id: string) => RUN_PREFIX + id;
const trackKey = (id: string) => `runbutan.track.${id}`;
export const MIN_SAVE_DISTANCE_M = 50; // ignore accidental start/stop taps

export type Run = {
  id: string;
  startedAt: number;
  distanceM: number;
  movingSec: number;
  elapsedSec?: number; // wall-clock time; older runs only have movingSec
  elevGainM?: number;
  avgPaceSec: number | null;
  splits: Split[];
  title?: string;
  efforts?: Effort[]; // fastest 400 m / 1 km / 5 km ... found inside this run
  badges?: Badge[]; // record callouts earned when the run was saved
  thumb?: [number, number][]; // ~60 [lat, lon] points for the list thumbnail (no route load needed)
};

export type Summary = {
  runs: number;
  distanceM: number;
  movingSec: number;
  elapsedSec: number;
  elevGainM: number;
  avgPaceSec: number | null; // total time / total distance (distance-weighted)
  avgDistanceM: number;
  bestAvgPaceSec: number | null;
  longestM: number;
};

const parseRun = (raw: string | null): Run | null => {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Run;
    return r && typeof r.id === 'string' && typeof r.startedAt === 'number' ? r : null;
  } catch {
    return null; // one corrupt run must not hide (or wipe) the others
  }
};

const makeThumb = (track: TrackPt[]): [number, number][] => {
  const n = track.length;
  const step = Math.max(1, Math.ceil(n / 60));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i += step) out.push([track[i].lat, track[i].lon]);
  if (n && (n - 1) % step !== 0) out.push([track[n - 1].lat, track[n - 1].lon]);
  return out;
};
export const thumbToTrack = (thumb: [number, number][]): TrackPt[] => thumb.map(([lat, lon], i) => ({ t: i, lat, lon }));

const rebuildIndex = async (): Promise<string[]> => {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(RUN_PREFIX));
  const got = await AsyncStorage.multiGet(keys);
  const runs = got.map(([, v]) => parseRun(v)).filter((r): r is Run => !!r).sort((a, b) => b.startedAt - a.startedAt);
  return runs.map((r) => r.id);
};

const migrateLegacy = async () => {
  const raw = await AsyncStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  let list: Run[];
  try {
    list = JSON.parse(raw) as Run[];
    if (!Array.isArray(list)) return;
  } catch {
    return; // leave the legacy data untouched rather than lose it
  }
  const valid = list.filter((r) => r && typeof r.id === 'string');
  await AsyncStorage.multiSet(valid.map((r) => [runKey(r.id), JSON.stringify(r)] as [string, string]));
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(valid.map((r) => r.id)));
  await AsyncStorage.removeItem(LEGACY_KEY); // only after everything above succeeded
};

// Throws on storage errors, so a failed read can never be mistaken for "no runs" and overwritten.
const readIndex = async (): Promise<string[]> => {
  let raw = await AsyncStorage.getItem(INDEX_KEY);
  if (raw === null) {
    await migrateLegacy();
    raw = await AsyncStorage.getItem(INDEX_KEY);
  }
  if (raw !== null) {
    try {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === 'string');
    } catch {
      // corrupt index: rebuild it from the run keys below
    }
  }
  const ids = await rebuildIndex();
  if (ids.length) await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  return ids;
};

// For display only (returns [] on error). Write paths use readIndex() instead.
export const loadRuns = async (): Promise<Run[]> => {
  try {
    const ids = await readIndex();
    const got = await AsyncStorage.multiGet(ids.map(runKey));
    return got.map(([, v]) => parseRun(v)).filter((r): r is Run => !!r);
  } catch {
    return [];
  }
};

export const saveRun = async (r: Run, track: TrackPt[] = [], force = false) => {
  if (!force && r.distanceM < MIN_SAVE_DISTANCE_M) return;
  const ids = await readIndex(); // throws if storage is unreadable: nothing is overwritten
  const run: Run = track.length > 1 ? { ...r, thumb: makeThumb(track) } : r;
  if (track.length > 1) await AsyncStorage.setItem(trackKey(r.id), JSON.stringify(track));
  await AsyncStorage.setItem(runKey(r.id), JSON.stringify(run));
  if (!ids.includes(r.id)) await AsyncStorage.setItem(INDEX_KEY, JSON.stringify([r.id, ...ids]));
};

export const updateRun = async (id: string, patch: Partial<Run>) => {
  const cur = parseRun(await AsyncStorage.getItem(runKey(id)));
  if (!cur) return;
  await AsyncStorage.setItem(runKey(id), JSON.stringify({ ...cur, ...patch }));
};

export const loadTrack = async (id: string): Promise<TrackPt[]> => {
  try {
    const raw = await AsyncStorage.getItem(trackKey(id));
    return raw ? (JSON.parse(raw) as TrackPt[]) : [];
  } catch {
    return [];
  }
};

export const deleteRun = async (id: string) => {
  const ids = await readIndex();
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(ids.filter((x) => x !== id)));
  await AsyncStorage.multiRemove([runKey(id), trackKey(id)]);
};

export const summarize = (runs: Run[]): Summary => {
  const distanceM = runs.reduce((a, r) => a + r.distanceM, 0);
  const movingSec = runs.reduce((a, r) => a + r.movingSec, 0);
  const elevGainM = runs.reduce((a, r) => a + (r.elevGainM ?? 0), 0);
  const elapsedSec = runs.reduce((a, r) => a + (r.elapsedSec ?? r.movingSec), 0);
  const paces = runs.map((r) => r.avgPaceSec).filter((p): p is number => p !== null);
  return {
    runs: runs.length,
    distanceM,
    movingSec,
    elapsedSec,
    elevGainM,
    avgPaceSec: distanceM > 0 ? movingSec / (distanceM / 1000) : null,
    avgDistanceM: runs.length ? distanceM / runs.length : 0,
    bestAvgPaceSec: paces.length ? Math.min(...paces) : null,
    longestM: runs.reduce((a, r) => Math.max(a, r.distanceM), 0),
  };
};
