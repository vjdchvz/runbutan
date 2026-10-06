import type { ZonePaces } from './vdot';

export type StepKind = 'warmup' | 'run' | 'walk' | 'recover' | 'cooldown';
export type Zone = 'easy' | 'marathon' | 'tempo' | 'interval' | 'rep';

export type Step = {
  kind: StepKind;
  sec?: number; // timed step...
  meters?: number; // ...or distance step
  zone?: Zone; // target effort/pace (needs the runner's paces to become a pace range)
  label?: string; // spoken/displayed name instead of the kind, e.g. "Hard"
};

export type Workout = { id: string; name: string; blurb: string; level: 'Beginner' | 'Intermediate' | 'Advanced'; steps: Step[] };

// ---- step builders -------------------------------------------------------
export const warm = (min = 5): Step => ({ kind: 'warmup', sec: min * 60 });
export const cool = (min = 5): Step => ({ kind: 'cooldown', sec: min * 60 });
export const run = (sec: number, zone?: Zone, label?: string): Step => ({ kind: 'run', sec, zone, label });
export const runM = (meters: number, zone?: Zone, label?: string): Step => ({ kind: 'run', meters, zone, label });
export const walk = (sec: number): Step => ({ kind: 'walk', sec });
export const rec = (sec: number): Step => ({ kind: 'recover', sec });
export const rep = (n: number, ...steps: Step[]): Step[] => Array.from({ length: n }, () => steps.map((s) => ({ ...s }))).flat();

// ---- helpers -------------------------------------------------------------
export const KIND_LABEL: Record<StepKind, string> = { warmup: 'Warm up', run: 'Run', walk: 'Walk', recover: 'Recover', cooldown: 'Cool down' };
export const stepName = (s: Step) => s.label ?? KIND_LABEL[s.kind];

export const workoutSeconds = (w: Workout, paceSecKm = 360) =>
  w.steps.reduce((a, s) => a + (s.sec ?? ((s.meters ?? 0) / 1000) * paceSecKm), 0);
export const workoutMeters = (w: Workout) => w.steps.reduce((a, s) => a + (s.meters ?? 0), 0);

export const fmtMin = (sec: number) => {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`;
};
export const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(2)} km`);
export const stepAmount = (s: Step) => (s.sec !== undefined ? fmtMin(s.sec) : fmtDist(s.meters ?? 0));

export const paceFmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

// Target pace range [fast, slow] in sec/km for a step, or null when there are no paces / no target.
export const targetRange = (s: Step, p?: ZonePaces | null): [number, number] | null => {
  if (!p || !s.zone || (s.kind !== 'run' && s.kind !== 'warmup' && s.kind !== 'cooldown')) return null;
  if (s.zone === 'easy') return p.easy;
  const c = { marathon: p.marathon, tempo: p.tempo, interval: p.interval, rep: p.rep }[s.zone];
  return [c * 0.97, c * 1.03];
};

export const effortWord = (z?: Zone) =>
  ({ easy: 'easy pace', marathon: 'steady pace', tempo: 'comfortably hard', interval: 'hard effort', rep: 'fast' } as Record<string, string>)[z ?? ''] ?? '';

// ---- quick workouts ------------------------------------------------------
export const QUICK: Workout[] = [
  { id: 'easy30', name: 'Easy run · 30 min', blurb: 'Relaxed, conversational pace.', level: 'Beginner', steps: [warm(3), run(24 * 60, 'easy'), cool(3)] },
  { id: 'runwalk', name: 'Run / walk · 30 min', blurb: '2 min run, 1 min walk. Great for building up.', level: 'Beginner', steps: [warm(5), ...rep(6, run(120), walk(60)), cool(5)] },
  { id: 'fartlek', name: 'Fartlek · 30 min', blurb: 'Play with speed: 2 min hard, 2 min easy.', level: 'Intermediate', steps: [warm(8), ...rep(5, run(120, 'interval', 'Hard'), rec(120)), cool(5)] },
  { id: 'pyramid', name: 'Pyramid · 1-2-3-2-1', blurb: 'Hard efforts that go up and down, with easy jogs between.', level: 'Intermediate', steps: [warm(10), run(60, 'interval', 'Hard'), rec(60), run(120, 'interval', 'Hard'), rec(90), run(180, 'interval', 'Hard'), rec(120), run(120, 'interval', 'Hard'), rec(90), run(60, 'interval', 'Hard'), cool(8)] },
  { id: 'tempo20', name: 'Tempo · 20 min', blurb: 'Sustained, comfortably hard running. Builds endurance.', level: 'Intermediate', steps: [warm(10), run(20 * 60, 'tempo', 'Tempo'), cool(8)] },
  { id: 'int400', name: 'Intervals · 6 × 400 m', blurb: 'Track-style repeats with a 90 s jog between.', level: 'Advanced', steps: [warm(10), ...rep(6, runM(400, 'interval', 'Fast 400'), rec(90)), cool(8)] },
  { id: 'int1k', name: 'Intervals · 5 × 1 km', blurb: 'Longer repeats at interval pace, 2 min jog between.', level: 'Advanced', steps: [warm(10), ...rep(5, runM(1000, 'interval', 'Hard km'), rec(120)), cool(8)] },
  { id: 'long10', name: 'Long run · 10 km', blurb: 'Easy distance run. Voice marks the halfway point.', level: 'Intermediate', steps: [warm(3), runM(10000, 'easy'), cool(3)] },
  { id: 'goal5k', name: 'Goal run · 5 km', blurb: 'Just run 5 km. The coach tracks your progress.', level: 'Beginner', steps: [runM(5000)] },
  { id: 'goal10k', name: 'Goal run · 10 km', blurb: 'Run 10 km with milestone call-outs.', level: 'Intermediate', steps: [runM(10000)] },
  { id: 'goal45', name: 'Time run · 45 min', blurb: 'Run for 45 minutes at your own pace.', level: 'Beginner', steps: [run(45 * 60)] },
];

// ---- plans ---------------------------------------------------------------
export type PlanSession = { id: string; title: string; workout: Workout };
export type Plan = { id: string; name: string; blurb: string; level: Workout['level']; weeks: PlanSession[][] };

const session = (planId: string, wk: number, n: number, title: string, steps: Step[]): PlanSession => ({
  id: `${planId}-w${wk}d${n}`,
  title,
  workout: { id: `${planId}-w${wk}d${n}`, name: `Week ${wk} · Run ${n}`, blurb: title, level: 'Beginner', steps },
});

const C25K_BODY: Step[][][] = [
  [rep(8, run(60), walk(90)), rep(8, run(60), walk(90)), rep(8, run(60), walk(90))],
  [rep(6, run(90), walk(120)), rep(6, run(90), walk(120)), rep(6, run(90), walk(120))],
  [rep(2, run(90), walk(90), run(180), walk(180)), rep(2, run(90), walk(90), run(180), walk(180)), rep(2, run(90), walk(90), run(180), walk(180))],
  [[run(180), walk(90), run(300), walk(150), run(180), walk(90), run(300)], [run(180), walk(90), run(300), walk(150), run(180), walk(90), run(300)], [run(180), walk(90), run(300), walk(150), run(180), walk(90), run(300)]],
  [[run(300), walk(180), run(300), walk(180), run(300)], [run(480), walk(300), run(480)], [run(1200)]],
  [[run(300), walk(180), run(480), walk(180), run(300)], [run(600), walk(180), run(600)], [run(1500)]],
  [[run(1500)], [run(1500)], [run(1500)]],
  [[run(1680)], [run(1680)], [run(1680)]],
  [[run(1800)], [run(1800)], [run(1800)]],
];

const couch5k: Plan = {
  id: 'c25k',
  name: 'Couch to 5K',
  blurb: '9 weeks · 3 runs a week. Walk/run intervals that take you from the sofa to 5 km non-stop.',
  level: 'Beginner',
  weeks: C25K_BODY.map((days, w) =>
    days.map((body, d) => session('c25k', w + 1, d + 1, `${w + 1 < 5 ? 'Run/walk intervals' : 'Longer runs'}`, [warm(5), ...body, cool(5)])),
  ),
};

const LONG_KM = [6, 7, 8, 6, 9, 10, 8, 10];
const tenK: Plan = {
  id: 'k10',
  name: '5K to 10K',
  blurb: '8 weeks · 3 runs a week: an easy run, a quality session and a growing long run.',
  level: 'Intermediate',
  weeks: Array.from({ length: 8 }, (_, i) => {
    const w = i + 1;
    const quality: Step[] =
      w % 2
        ? [warm(10), ...rep(4 + Math.floor(w / 2), run(120, 'interval', 'Hard'), rec(120)), cool(5)]
        : [warm(10), run((10 + w * 2) * 60, 'tempo', 'Tempo'), cool(5)];
    return [
      session('k10', w, 1, 'Easy run', [warm(3), run((22 + w * 2) * 60, 'easy'), cool(3)]),
      session('k10', w, 2, w % 2 ? 'Fartlek speed play' : 'Tempo run', quality),
      session('k10', w, 3, `Long run · ${LONG_KM[i]} km`, [warm(3), runM(LONG_KM[i] * 1000, 'easy'), cool(3)]),
    ];
  }),
};

const speed5k: Plan = {
  id: 's5k',
  name: '5K Speed',
  blurb: '6 weeks · 3 runs a week. Intervals, tempo and strides to run a faster 5K. Uses your pace zones.',
  level: 'Advanced',
  weeks: Array.from({ length: 6 }, (_, i) => {
    const w = i + 1;
    return [
      session('s5k', w, 1, `Intervals · ${5 + w} × 400 m`, [warm(10), ...rep(5 + w, runM(400, 'interval', 'Fast 400'), rec(90)), cool(8)]),
      session('s5k', w, 2, `Tempo · ${12 + w * 3} min`, [warm(10), run((12 + w * 3) * 60, 'tempo', 'Tempo'), cool(8)]),
      session('s5k', w, 3, 'Easy run + strides', [warm(3), run(20 * 60, 'easy'), ...rep(6, run(20, 'rep', 'Stride'), rec(40)), cool(3)]),
    ];
  }),
};

export const PLANS: Plan[] = [couch5k, tenK, speed5k];
export const planById = (id: string) => PLANS.find((p) => p.id === id);
export const planSessions = (p: Plan) => p.weeks.flat();
