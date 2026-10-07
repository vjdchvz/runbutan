import * as Speech from 'expo-speech';
import { advance, CoachState, newCoach, skipStep, status as coachStatus } from './coach/engine';
import type { ZonePaces } from './coach/vdot';
import { getSettings, Unit } from './settings';
import { distNum, paceInUnit, unitMeters, unitWord, unitWordSingular } from './units';
import { abandonDuck, requestDuck } from './audioSession';
import { holdBeat, setBeatOn } from './beat';
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

// How the app's name is spoken (the voice would spell "RUN" out letter by letter).
export const SPOKEN_NAME = 'Rambutan';

// Audio focus: while the coach speaks, other audio (music) is asked to lower its volume.
let speaking = 0;
let focusGuard: ReturnType<typeof setTimeout> | null = null;
const releaseFocus = () => {
  speaking = Math.max(0, speaking - 1);
  if (speaking === 0) {
    if (focusGuard) clearTimeout(focusGuard);
    abandonDuck();
  }
};

const speakNow = (text: string, interrupt = false) => {
  if (!voiceOn) return;
  const st = getSettings();
  if (interrupt) Speech.stop(); // a new instruction should cut off the previous sentence
  const duck = st.duck;
  if (duck) {
    speaking++;
    requestDuck();
    // safety net: if the speech engine never reports "done", don't leave the music turned down
    if (focusGuard) clearTimeout(focusGuard);
    focusGuard = setTimeout(() => {
      speaking = 0;
      abandonDuck();
    }, 20000);
  }
  const done = () => {
    if (duck) releaseFocus();
  };
  const voice = st.voiceId ?? voiceId;
  Speech.speak(text, {
    ...(voice ? { voice } : { language: 'en-US' }),
    rate: st.rate,
    onDone: done,
    onStopped: done,
    onError: () => {
      done();
      Speech.speak(text, { rate: st.rate }); // retry once with the engine default
    },
  });
};
export const sayCoach = (text: string, interrupt = false) => speakNow(text, interrupt);
export const stopSpeech = () => Speech.stop();
export const speakTest = () => speakNow(`Voice check. ${SPOKEN_NAME} is ready.`);

const PACE_WINDOW_MS = 10_000; // fallback only (no speed from the phone): distance over the last 10 s
const SPEED_ALPHA = 0.35; // real-time speed smoothing: reacts within ~3 s
const STAND_MS = 0.4; // below this speed you are standing still
// Strava's rule for MOVING TIME (what average pace is based on): faster than a 30-minute-mile pace counts as
// moving, and slower time only counts as rest once it lasts more than 15 s (a quick stop at a light still counts).
const STRAVA_MOVING_MS = 0.894; // 1609 m in 30 min
const REST_AFTER_MS = 15_000;
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
let movingMs = 0; // moving time already settled
let slowMs = 0; // current stretch below the moving speed: counts as moving only if it ends within 15 s
const movingTotalMs = () => movingMs + (slowMs <= REST_AFTER_MS ? slowMs : 0);
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
let splitM = 1000; // length of one split (1 km or 1 mile), fixed for the whole run
let splitUnit: Unit = 'km';
let coachW: Workout | null = null;
let coachSt: CoachState | null = null;
let coachPaces: ZonePaces | null = null;
let coachTimer: ReturnType<typeof setInterval> | null = null;
let fixesSeen = 0;
let speedEma: number | null = null; // smoothed real-time speed, m/s
let dopplerSeen = false; // has this phone ever reported a real (non-zero) speed this run?
let anchor: { lat: number; lon: number } | null = null; // jitter-proof distance anchor (phones without speed)
let speedWall = 0; // wall-clock time of the last speed update
let bestAcc: number | null = null;

export const fmtPace = (sec: number | null) => {
  if (sec === null || !isFinite(sec) || sec <= 0) return '--:--';
  sec = paceInUnit(sec); // callers pass seconds per km; show it in the chosen unit
  if (sec > 3599) return '--:--';
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
  // Real-time: the smoothed speed. Stale (no fix for 6 s) or standing still means no pace.
  if (speedEma !== null) {
    if (Date.now() - speedWall > 6000 || speedEma < STAND_MS) return null;
    return 1000 / speedEma;
  }
  if (pts.length - segStart < 2) return null;
  const last = pts[pts.length - 1];
  const target = last.t - PACE_WINDOW_MS;
  let ref = pts[segStart];
  for (let i = pts.length - 1; i >= segStart; i--) {
    if (pts[i].t <= target) {
      ref = pts[i];
      break;
    }
  }
  const dM = last.dist - ref.dist;
  const dS = (last.t - ref.t) / 1000;
  return dM > 3 && dS > 0 ? dS / (dM / 1000) : null;
};

export const getStats = (): Stats => {
  const dist = pts.length ? pts[pts.length - 1].dist : 0;
  const movingSec = movingTotalMs() / 1000;
  return {
    running,
    paused,
    distanceM: dist,
    movingSec,
    currentPaceSec: running && !paused ? currentPace() : null, // no live pace once stopped or paused
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
  const st = getSettings();
  const say = (secPerKm: number | null) => {
    if (secPerKm === null) return null;
    const p = paceInUnit(secPerKm);
    const m = Math.floor(p / 60);
    const sec = Math.round(p % 60);
    return `${m} minutes ${sec} seconds`;
  };
  const cur = say(s.currentPaceSec);
  const avg = say(s.avgPaceSec);
  const parts = [
    st.sayPace && cur ? `Pace ${cur}.` : null,
    st.sayAvg && avg ? `Average ${avg}.` : null,
    st.sayDist ? `${distNum(s.distanceM)} ${unitWord()}.` : null,
    st.sayTime ? `Time ${fmtTime(s.movingSec)}.` : null,
  ].filter(Boolean);
  if (parts.length) speakNow(parts.join(' '));
};

const speakSplit = (sp: Split) => {
  if (!getSettings().saySplits) return;
  const m = Math.floor(sp.splitSec / 60);
  const s = Math.round(sp.splitSec % 60);
  speakNow(
    `${unitWordSingular()} ${sp.km} done. Split ${m} minutes ${s} seconds. Total time ${fmtTime(sp.totalSec)}.`,
  );
};

export const getStartedAt = () => startedAt;
export const getSplitUnit = () => splitUnit;

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
  slowMs = 0;
  splits = [];
  lastSplitTotalSec = 0;
  lastAnnounceT = 0;
  coachSpokeAt = 0;
  running = true;
  startedAt = Date.now();
  stoppedAt = 0;
  paused = false;
  pausedMs = 0;
  pauseStartedAt = 0;
  resumePending = false;
  segStart = 0;
  staleDropped = 0;
  splitM = unitMeters();
  splitUnit = getSettings().unit;
  coachW = workout ?? null;
  coachSt = workout ? newCoach() : null;
  coachPaces = paces ?? null;
  if (coachTimer) clearInterval(coachTimer);
  coachTimer = workout ? setInterval(() => coachTick(), 1000) : null;
  fixesSeen = 0;
  speedEma = null;
  speedWall = 0;
  dopplerSeen = false;
  anchor = null;
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
  unit: getSettings().unit,
});
const coachLive = () => !!coachW && !!coachSt && !coachSt.finished;

let coachSpokeAt = 0;
const runCoach = () => {
  if (!coachW || !coachSt || !running || paused) return;
  for (const c of advance(coachSt, coachW, coachInput())) {
    speakNow(c.text, c.interrupt);
    coachSpokeAt = Date.now();
  }
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

// After a run has been saved: wipe the finished run so the RUN screen starts fresh (0.00 km, 00:00, --:--).
export const resetSession = () => {
  if (running) return;
  pts = [];
  track = [];
  splits = [];
  movingMs = 0;
  slowMs = 0;
  gainM = 0;
  lossM = 0;
  altSmooth = null;
  altRef = null;
  speedEma = null;
  speedWall = 0;
  anchor = null;
  startedAt = 0;
  stoppedAt = 0;
  pausedMs = 0;
  paused = false;
  lastSplitTotalSec = 0;
  coachW = null;
  coachSt = null;
  emit();
};

export const pauseSession = () => {
  if (!running || paused) return;
  paused = true;
  pauseStartedAt = Date.now();
  holdBeat(true);
  speakNow('Run paused.');
  emit();
};

export const resumeSession = () => {
  if (!running || !paused) return;
  pausedMs += Date.now() - pauseStartedAt;
  paused = false;
  resumePending = true; // next good fix re-anchors, so the pause gap adds no time or distance
  holdBeat(false);
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
  holdBeat(false);
  setBeatOn(false); // the run is over: so is the beat
  const s = getStats();
  speakNow(
    `Run finished. ${distNum(s.distanceM)} ${unitWord()} in ${fmtTime(s.movingSec)}.`,
  );
  emit();
};

export const addFix = (f: {
  lat: number;
  lon: number;
  t: number;
  accuracy: number | null;
  speed?: number | null; // the phone's own GPS (Doppler) speed in m/s
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
    if (slowMs > 0 && slowMs <= REST_AFTER_MS) movingMs += slowMs; // settle the slow stretch from before the pause
    slowMs = 0;
    speedEma = null; // new segment after a pause: start the speed estimate afresh
    anchor = null;
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
  const winSpeed = winS > 0 ? haversine(ref, f.lat, f.lon) / winS : 0;
  // A longer ~10 s window for phones with no speed: noisy positions need more averaging.
  let ref10 = ref;
  for (let i = pts.length - 1; i >= segStart; i--) {
    ref10 = pts[i];
    if (f.t - pts[i].t >= 10000) break;
  }
  const win10S = (f.t - ref10.t) / 1000;
  const winSpeed10 = win10S > 0 ? haversine(ref10, f.lat, f.lon) / win10S : winSpeed;

  // The phone's own speed (Doppler) is far more accurate than differences between noisy positions.
  // Some phones always report 0: if it says "still" while positions clearly moved, ignore it.
  const dop = f.speed != null && isFinite(f.speed) && f.speed >= 0 && (f.accuracy === null || f.accuracy <= 30) ? f.speed : null;
  if (dop !== null && dop > 0.3) dopplerSeen = true;
  // A "0" speed is only believed once this phone has shown a real, non-zero speed during the run. Until then
  // the positions decide, because some phones (and the emulator) always report 0 even while moving.
  const useDop = dop !== null && dopplerSeen;
  const instSpeed = useDop ? (dop as number) : winSpeed10;
  speedEma = speedEma === null ? instSpeed : speedEma + SPEED_ALPHA * (instSpeed - speedEma);
  speedWall = Date.now();

  const moving = useDop ? (dop as number) >= STAND_MS : winSpeed >= MIN_MOVING_MS;
  // Distance. Raw GPS positions jitter by a few metres, and adding up that jitter makes slow walking look
  // far longer than it was. So: with a trusted speed, distance = speed x time (accurate to ~1%).
  // Without speed, only count a step once you have moved clearly further than the GPS noise.
  let inc = 0;
  if (moving) {
    if (useDop) {
      const v = (dop as number) * dt;
      inc = dt <= 3 ? v : Math.min(d, v * 1.3 + 2);
    } else {
      if (!anchor) anchor = { lat: prev.lat, lon: prev.lon };
      const da = haversine(anchor, f.lat, f.lon);
      if (da >= Math.max(10, (f.accuracy ?? 8) * 2.5)) {
        inc = da;
        anchor = { lat: f.lat, lon: f.lon };
      }
    }
  } else {
    anchor = null;
  }
  const dist = prev.dist + inc;
  // Strava-style moving time (see STRAVA_MOVING_MS): track slow stretches and decide when they end.
  const movBefore = movingTotalMs();
  if ((speedEma ?? 0) >= STRAVA_MOVING_MS) {
    if (slowMs > 0 && slowMs <= REST_AFTER_MS) movingMs += slowMs; // it was only a brief slow patch
    slowMs = 0; // a longer one was rest: dropped
    movingMs += dt * 1000;
  } else {
    slowMs += dt * 1000;
  }
  const movAfter = movingTotalMs();
  const cur: Pt = { t: f.t, lat: f.lat, lon: f.lon, dist };
  pts.push(cur);
  if (moving) updateAlt(f.altitude, f.altitudeAccuracy);
  rec(f);

  // Kilometer splits — interpolate the exact crossing time between fixes.
  // A long GPS gap can cross several km marks in one step, so record every one that was crossed.
  let crossed: Split | null = null;
  while (moving && dist > prev.dist && dist >= (splits.length + 1) * splitM) {
    const km = splits.length + 1; // split number (km or mile)
    const frac = Math.min(1, Math.max(0, (km * splitM - prev.dist) / (dist - prev.dist)));
    const totalSec = Math.max(lastSplitTotalSec, (movBefore + frac * Math.max(0, movAfter - movBefore)) / 1000);
    const sp: Split = { km, splitSec: Math.max(1, totalSec - lastSplitTotalSec), totalSec };
    lastSplitTotalSec = totalSec;
    splits = [...splits, sp];
    crossed = sp;
  }
  if (crossed) {
    speakSplit(crossed);
    lastAnnounceT = f.t; // avoid talking over the split call-out
  } else if (
    getSettings().announceSec > 0 &&
    f.t - lastAnnounceT >= getSettings().announceSec * 1000 &&
    Date.now() - coachSpokeAt >= 8000 // during a guided workout: never talk over a coach instruction
  ) {
    lastAnnounceT = f.t;
    speakPace(getStats());
  }

  runCoach();
  emit();
};
