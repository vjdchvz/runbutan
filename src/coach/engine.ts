import { effortWord, KIND_LABEL, paceFmt, Step, stepName, targetRange, Workout, workoutSeconds } from './workouts';
import type { ZonePaces } from './vdot';

// The coaching brain. Pure: give it the clock and distance, it says what changed and what to say.
export type CoachState = {
  i: number; // current step
  stepStartSec: number;
  stepStartM: number;
  flags: Record<string, boolean>;
  lastPaceCue: number;
  started: boolean;
  finished: boolean;
};
export type Input = { activeSec: number; distM: number; paceSecKm: number | null; paces?: ZonePaces | null };
export type Cue = { text: string; interrupt?: boolean };

export const newCoach = (): CoachState => ({ i: 0, stepStartSec: 0, stepStartM: 0, flags: {}, lastPaceCue: -999, started: false, finished: false });

const spokenDur = (sec: number) => {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  const parts = [m ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : '', s ? `${s} seconds` : ''].filter(Boolean);
  return parts.join(' ');
};
const spokenDist = (m: number) => (m < 1000 ? `${Math.round(m)} meters` : `${+(m / 1000).toFixed(2)} kilometers`);
const spokenPace = (sec: number) => `${Math.floor(sec / 60)} ${String(Math.round(sec % 60)).padStart(2, '0')}`;

const startCue = (s: Step, paces?: ZonePaces | null) => {
  const amount = s.sec !== undefined ? spokenDur(s.sec) : spokenDist(s.meters ?? 0);
  const range = targetRange(s, paces);
  const tail = range
    ? ` Target pace ${spokenPace((range[0] + range[1]) / 2)} per kilometer.`
    : s.zone ? ` ${effortWord(s.zone)}.` : '';
  return `${stepName(s)}. ${amount}.${tail}`;
};

export type Status = {
  index: number;
  total: number;
  step: Step;
  next: Step | null;
  remainingSec: number | null;
  remainingM: number | null;
  frac: number;
  range: [number, number] | null;
  finished: boolean;
};

const measure = (st: CoachState, s: Step, inp: Input) => {
  if (s.sec !== undefined) {
    const done = inp.activeSec - st.stepStartSec;
    return { done, total: s.sec, remaining: s.sec - done };
  }
  const done = inp.distM - st.stepStartM;
  return { done, total: s.meters ?? 0, remaining: (s.meters ?? 0) - done };
};

export const status = (st: CoachState, w: Workout, inp: Input): Status => {
  const idx = Math.min(st.i, w.steps.length - 1);
  const step = w.steps[idx];
  const m = measure(st, step, inp);
  return {
    index: idx,
    total: w.steps.length,
    step,
    next: w.steps[idx + 1] ?? null,
    remainingSec: step.sec !== undefined ? Math.max(0, Math.ceil(m.remaining)) : null,
    remainingM: step.sec === undefined ? Math.max(0, Math.round(m.remaining)) : null,
    frac: st.finished ? 1 : m.total > 0 ? Math.min(1, Math.max(0, m.done / m.total)) : 0,
    range: targetRange(step, inp.paces),
    finished: st.finished,
  };
};

const toNext = (st: CoachState, w: Workout, inp: Input, cues: Cue[]) => {
  st.i++;
  st.flags = {};
  st.stepStartSec = inp.activeSec;
  st.stepStartM = inp.distM;
  st.lastPaceCue = inp.activeSec;
  if (st.i >= w.steps.length) {
    st.finished = true;
    const km = (inp.distM / 1000).toFixed(2);
    cues.push({ text: `Workout complete. ${km} kilometers in ${spokenDur(inp.activeSec)}. Great job!`, interrupt: true });
    return false;
  }
  cues.push({ text: startCue(w.steps[st.i], inp.paces), interrupt: true });
  return true;
};

export const skipStep = (st: CoachState, w: Workout, inp: Input): Cue[] => {
  const cues: Cue[] = [];
  if (!st.finished) toNext(st, w, inp, cues);
  return cues;
};

export const advance = (st: CoachState, w: Workout, inp: Input): Cue[] => {
  const cues: Cue[] = [];
  if (st.finished) return cues;

  if (!st.started) {
    st.started = true;
    st.stepStartSec = inp.activeSec;
    st.stepStartM = inp.distM;
    const mins = Math.round(workoutSeconds(w) / 60);
    cues.push({ text: `Starting ${w.name}. ${w.steps.length} parts, about ${mins} minutes. ${startCue(w.steps[0], inp.paces)}`, interrupt: true });
  }

  for (let guard = 0; guard < 25 && !st.finished; guard++) {
    const s = w.steps[st.i];
    const m = measure(st, s, inp);
    if (m.remaining <= 0) {
      if (!toNext(st, w, inp, cues)) break;
      continue;
    }
    const timed = s.sec !== undefined;
    if (timed) {
      if (m.total >= 240 && !st.flags.half && m.done >= m.total / 2) {
        st.flags.half = true;
        cues.push({ text: 'Halfway through this part.' });
      }
      if (m.total >= 30 && m.remaining <= 10 && !st.flags.ten) {
        st.flags.ten = true;
        cues.push({ text: 'Ten seconds.' });
      }
      if (m.total >= 10 && m.remaining <= 3 && !st.flags.three) {
        st.flags.three = true;
        cues.push({ text: 'Three, two, one.' });
      }
    } else {
      if (m.total >= 1000 && !st.flags.half && m.done >= m.total / 2) {
        st.flags.half = true;
        cues.push({ text: `Halfway. ${spokenDist(m.remaining)} to go.` });
      }
      if (m.total >= 1000 && !st.flags.near && m.remaining <= 400) {
        st.flags.near = true;
        cues.push({ text: `${spokenDist(m.remaining)} to go. Finish strong.` });
      }
    }
    // Pace feedback against the step's target pace.
    const range = targetRange(s, inp.paces);
    const lastSeconds = timed && m.remaining <= 10;
    if (range && inp.paceSecKm && m.done >= 33 && !lastSeconds && inp.activeSec - st.lastPaceCue >= 25) {
      if (inp.paceSecKm > range[1] * 1.05) {
        st.lastPaceCue = inp.activeSec;
        cues.push({ text: 'Speed up a little.' });
      } else if (inp.paceSecKm < range[0] * 0.95) {
        st.lastPaceCue = inp.activeSec;
        cues.push({ text: "Ease off, you're ahead of pace." });
      }
    }
    break;
  }
  return cues;
};

export { KIND_LABEL, paceFmt };
