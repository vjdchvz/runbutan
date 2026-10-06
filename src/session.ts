import * as Speech from 'expo-speech';
import { advance, CoachState, newCoach, skipStep, status as coachStatus } from './coach/engine';
import type { ZonePaces } from './coach/vdot';
import type { Workout } from './coach/workouts';

let voiceOn = true;
export const setVoiceEnabled = (on: boolean) => {
  voiceOn = on;
  if (!on) Speech.stop();
};
let voiceId: string | undefined;
export const initVoice = async () => {
  try {
    const en = (await Speech.getAvailableVoicesAsync()).filter((v) => v.language?.toLowerCase().startsWith('en'));
    voiceId = (en.find((v) => /en[-_]us/i.test(v.language)) ?? en[0])?.identifier;
  } catch {
    // no voice list: fall back to the default engine voice
  }
};

const speakNow = (text: string, interrupt = false) => {
  if (!voiceOn) return;
  if (interrupt) Speech.stop(); // a new instruction should cut off the previous sentence
  Speech.speak(text, {
    ...(voiceId ? { voice: voiceId } : { language: 'en-US' }),
    onError: () => Speech.speak(text), // retry once with the engine default
  });
};
export const sayCoach = (text: string, interrupt = false) => speakNow(text, interrupt);
export const stopSpeech = () => Speech.stop();
export const speakTest = () => speakNow('Voice check. RUNbutan is ready.');

export const ANNOUNCE_EVERY_MS = 30_000;
const MAX_ACCURACY_M = 35; // looser than 25 so weak city GPS doesn't stall the run
const MAX_SPEED_MS = 12; // reject GPS jumps (~43 km/h)
const MIN_MOVING_MS = 0.5; // below this the runner is standing still
const ALT_ALPHA = 0.05; // GPS altitude is noisy: smooth it...
const ALT_STEP_M = 5; // ...and only count a climb/drop once it moves this far from the last counted level
const MAX_ALT_ACC_M = 30;

export type TrackPt = { t: number; lat: number; lon: number; ele?: number };
type Pt = { t: number; lat: number; lon: number; dist: number };
export type Split = { km: number; splitSec: number; totalSec: number };
export type Stats = {
  running: boolean;
  paused: boolean;
  distanceM: number;
  movingSec: number;
  currentPaceSec: number | null;
  avgPaceSec: number | null;
  splits: Split[];
  elevGainM: number;
  elevLossM: number;
  altitudeM: number | null;
};

type Listener = (s: Stats) => void;

const listeners = new Set<Listener>();
let pts: Pt[] = [];
let track: TrackPt[] = []; // thinned (~2 s) route for the map + GPX
let movingMs = 0;
let running = false;
let lastAnnounceT = 0;
let lastSplitTotalSec = 0;
let startedAt = 0;
let stoppedAt = 0;
let gpsAcc: number | null = null;
let gpsAt = 0;
let splits: Split[] = [];
let altSmooth: number | null = null;
let altRef: number | null = null;
let gainM = 0;
let lossM = 0;
let paused = false;
let pausedMs = 0;
let pauseStartedAt = 0;
let resumePending = false;
let segStart = 0; // index in pts where the current (post-resume) segment begins
let waitedForGps = false;
let staleDropped = 0;
let coachW: Workout | null = null;
let coachSt: CoachState | null = null;
let coachPaces: ZonePaces | null = null;
let coachTimer: ReturnType<typeof setInterval> | null = null;
let fixesSeen = 0;
let bestAcc: number | null = null;

export const fmtPace = (sec: number | null) => {
  if (sec === null || !isFinite(sec) || sec <= 0 || sec > 3599) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
};

export const fmtTime = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const haversine = (a: Pt | { lat: number; lon: number }, lat: number, lon: number) => {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat - a.lat) * rad;
  const dLon = (lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const currentPace = (): number | null => {
  if (pts.length - segStart < 2) return null;
  const last = pts[pts.length - 1];
  const target = last.t - ANNOUNCE_EVERY_MS;
  let ref = pts[segStart];
  for (let i = pts.length - 1; i >= segStart; i--) {
    if (pts[i].t <= target) {
      ref = pts[i];
      break;
    }
  }
  const dM = last.dist - ref.dist;
  const dS = (last.t - ref.t) / 1000;
  return dM > 5 ? dS / (dM / 1000) : null;
};

export const getStats = (): Stats => {
  const dist = pts.length ? pts[pts.length - 1].dist : 0;
  const movingSec = movingMs / 1000;
  return {
    running,
    paused,
    distanceM: dist,
    movingSec,
    currentPaceSec: currentPace(),
    avgPaceSec: dist > 10 ? movingSec / (dist / 1000) : null,
    splits,
    elevGainM: gainM,
    elevLossM: lossM,
    altitudeM: altSmooth,
  };
};

const emit = () => {
  const s = getStats();
  listeners.forEach((l) => l(s));
};

export const subscribe = (l: Listener) => {
  listeners.add(l);
  l(getStats());
  return () => {
    listeners.delete(l);
  };
};

const speakPace = (s: Stats) => {
  const say = (p: number | null) => {
    if (p === null) return null;
    const m = Math.floor(p / 60);
    const sec = Math.round(p % 60);
    return `${m} minutes ${sec} seconds`;
  };
  const cur = say(s.currentPaceSec);
  const avg = say(s.avgPaceSec);
  const km = (s.distanceM / 1000).toFixed(2);
  const parts = [
    cur ? `Pace ${cur}.` : null,
    avg ? `Average ${avg}.` : null,
    `${km} kilometers.`,
  ].filter(Boolean);
  speakNow(parts.join(' '));
};

const speakSplit = (sp: Split) => {
  const m = Math.floor(sp.splitSec / 60);
  const s = Math.round(sp.splitSec % 60);
  speakNow(
    `Kilometer ${sp.km} done. Split ${m} minutes ${s} seconds. Total time ${fmtTime(sp.totalSec)}.`,
  );
};

export const getStartedAt = () => startedAt;

// Wall-clock time since START: keeps ticking even when GPS fixes stop arriving.
export const getElapsedSec = () => {
  if (!startedAt) return 0;
  const end = stoppedAt || (paused ? pauseStartedAt : Date.now());
  return Math.max(0, end - startedAt - pausedMs) / 1000;
};

// What the GPS gave us during the run, so a run that recorded nothing can be explained.
export const getGpsDiag = () => ({ fixesSeen, bestAccuracy: bestAcc });

export const reportGps = (accuracy: number | null) => {
  gpsAcc = accuracy;
  gpsAt = Date.now();
};
export const getGps = () => ({ accuracy: gpsAcc, ageMs: gpsAt ? Date.now() - gpsAt : Infinity });

const updateAlt = (alt: number | null | undefined, acc: number | null | undefined) => {
  if (alt == null || !isFinite(alt) || (acc != null && acc > MAX_ALT_ACC_M)) return;
  altSmooth = altSmooth === null ? alt : altSmooth + ALT_ALPHA * (alt - altSmooth);
  if (altRef === null) {
    altRef = altSmooth;
    return;
  }
  const d = altSmooth - altRef;
  if (d >= ALT_STEP_M) {
    gainM += d;
    altRef = altSmooth;
  } else if (d <= -ALT_STEP_M) {
    lossM += -d;
    altRef = altSmooth;
  }
};

const rec = (f: { t: number; lat: number; lon: number }) => {
  const l = track[track.length - 1];
  if (!l || f.t - l.t >= 2000) {
    track.push({ t: f.t, lat: f.lat, lon: f.lon, ...(altSmooth !== null ? { ele: Math.round(altSmooth * 10) / 10 } : {}) });
  }
};

export const getTrack = (): TrackPt[] => {
  const last = pts[pts.length - 1];
  const t = track[track.length - 1];
  return last && (!t || t.t !== last.t)
    ? [...track, { t: last.t, lat: last.lat, lon: last.lon }]
    : track.slice();
};

export const startSession = (workout?: Workout | null, paces?: ZonePaces | null) => {
  pts = [];
  track = [];
  altSmooth = null;
  altRef = null;
  gainM = 0;
  lossM = 0;
  movingMs = 0;
  splits = [];
  lastSplitTotalSec = 0;
  lastAnnounceT = 0;
  running = true;
  startedAt = Date.now();
  stoppedAt = 0;
  paused = false;
  pausedMs = 0;
  pauseStartedAt = 0;
  resumePending = false;
  segStart = 0;
  staleDropped = 0;
  coachW = workout ?? null;
  coachSt = workout ? newCoach() : null;
  coachPaces = paces ?? null;
  if (coachTimer) clearInterval(coachTimer);
  coachTimer = workout ? setInterval(() => coachTick(), 1000) : null;
  fixesSeen = 0;
  bestAcc = null;
  const g = getGps();
  waitedForGps = !(g.accuracy !== null && g.ageMs < 8000 && g.accuracy <= MAX_ACCURACY_M);
  if (coachW) runCoach();
  else speakNow(waitedForGps ? 'Run started. Waiting for GPS.' : 'Run started. Go!');
  emit();
};

// ---- voice coaching: a guided workout rides on top of the normal run ----------------------------
const coachInput = () => ({
  activeSec: getElapsedSec(),
  distM: pts.length ? pts[pts.length - 1].dist : 0,
  paceSecKm: currentPace(),
  paces: coachPaces,
});
const coachLive = () => !!coachW && !!coachSt && !coachSt.finished;

const runCoach = () => {
  if (!coachW || !coachSt || !running || paused) return;
  for (const c of advance(coachSt, coachW, coachInput())) speakNow(c.text, c.interrupt);
};
// Called once a second by the screen, and on every GPS fix, so step changes keep coming with the screen off.
export const coachTick = () => {
  if (!coachLive()) return;
  runCoach();
  emit();
};
export const getCoach = () => (coachW && coachSt ? { workout: coachW, ...coachStatus(coachSt, coachW, coachInput()) } : null);
export const skipCoachStep = () => {
  if (!coachW || !coachSt || !running) return;
  for (const c of skipStep(coachSt, coachW, coachInput())) speakNow(c.text, c.interrupt);
  emit();
};
export const getCoachResult = () => ({ workoutId: coachW?.id ?? null, finished: !!coachSt?.finished });

export const pauseSession = () => {
  if (!running || paused) return;
  paused = true;
  pauseStartedAt = Date.now();
  speakNow('Run paused.');
  emit();
};

export const resumeSession = () => {
  if (!running || !paused) return;
  pausedMs += Date.now() - pauseStartedAt;
  paused = false;
  resumePending = true; // next good fix re-anchors, so the pause gap adds no time or distance
  speakNow('Run resumed.');
  emit();
};

export const stopSession = () => {
  if (paused) {
    pausedMs += Date.now() - pauseStartedAt;
    paused = false;
  }
  running = false;
  if (coachTimer) {
    clearInterval(coachTimer);
    coachTimer = null;
  }
  stoppedAt = Date.now();
  const s = getStats();
  speakNow(
    `Run finished. ${(s.distanceM / 1000).toFixed(2)} kilometers in ${fmtTime(s.movingSec)}.`,
  );
  emit();
};

export const addFix = (f: {
  lat: number;
  lon: number;
  t: number;
  accuracy: number | null;
  altitude?: number | null;
  altitudeAccuracy?: number | null;
}) => {
  if (!running) return;
  runCoach(); // time-based steps must not wait for a *good* fix
  reportGps(f.accuracy);
  fixesSeen++;
  if (f.accuracy !== null && (bestAcc === null || f.accuracy < bestAcc)) bestAcc = f.accuracy;
  if (paused) return;
  // Drop the stale cached fix some phones deliver at start. If fix times keep looking "old" (the phone's
  // clock is off from GPS time), stop dropping after a few so the whole run isn't thrown away.
  if (f.t < startedAt - 2000 && staleDropped < 8) {
    staleDropped++;
    return;
  }
  if (f.accuracy !== null && f.accuracy > MAX_ACCURACY_M) return;

  if (resumePending && pts.length) {
    resumePending = false;
    pts.push({ t: f.t, lat: f.lat, lon: f.lon, dist: pts[pts.length - 1].dist });
    segStart = pts.length - 1;
    lastAnnounceT = f.t;
    rec(f);
    emit();
    return;
  }

  const prev = pts[pts.length - 1];
  if (!prev) {
    pts.push({ t: f.t, lat: f.lat, lon: f.lon, dist: 0 });
    updateAlt(f.altitude, f.altitudeAccuracy);
    rec(f);
    lastAnnounceT = f.t;
    if (waitedForGps) speakNow('GPS locked. Go!');
    emit();
    return;
  }

  const dt = (f.t - prev.t) / 1000;
  if (dt <= 0) return;
  const d = haversine(prev, f.lat, f.lon);
  const speed = d / dt;
  if (speed > MAX_SPEED_MS) return;

  // Moving test over a ~5 s window, so duplicate/jittery single fixes don't drop time.
  let ref = prev;
  for (let i = pts.length - 1; i >= segStart; i--) {
    ref = pts[i];
    if (f.t - pts[i].t >= 5000) break;
  }
  const winS = (f.t - ref.t) / 1000;
  const moving = winS > 0 && haversine(ref, f.lat, f.lon) / winS >= MIN_MOVING_MS;
  const dist = prev.dist + (moving ? d : 0);
  if (moving) movingMs += dt * 1000;
  const cur: Pt = { t: f.t, lat: f.lat, lon: f.lon, dist };
  pts.push(cur);
  if (moving) updateAlt(f.altitude, f.altitudeAccuracy);
  rec(f);

  // Kilometer splits — interpolate the exact crossing time between fixes.
  // A long GPS gap can cross several km marks in one step, so record every one that was crossed.
  let crossed: Split | null = null;
  while (moving && dist > prev.dist && dist >= (splits.length + 1) * 1000) {
    const km = splits.length + 1;
    const frac = Math.min(1, Math.max(0, (km * 1000 - prev.dist) / (dist - prev.dist)));
    const movingAtPrev = movingMs - dt * 1000;
    const totalSec = (movingAtPrev + frac * dt * 1000) / 1000;
    const sp: Split = { km, splitSec: totalSec - lastSplitTotalSec, totalSec };
    lastSplitTotalSec = totalSec;
    splits = [...splits, sp];
    crossed = sp;
  }
  if (crossed) {
    speakSplit(crossed);
    lastAnnounceT = f.t; // avoid talking over the split call-out
  } else if (!coachLive() && f.t - lastAnnounceT >= ANNOUNCE_EVERY_MS) {
    lastAnnounceT = f.t;
    speakPace(getStats());
  }

  runCoach();
  emit();
};
