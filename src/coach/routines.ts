// Voice-guided routines (no GPS): a timer walks through the exercises and the coach talks you through them.
export type RStep = { name: string; sec: number; tip?: string; rest?: boolean };
export type Routine = { id: string; name: string; blurb: string; steps: RStep[] };

const ex = (name: string, sec: number, tip?: string): RStep => ({ name, sec, tip });
const rest = (sec = 15): RStep => ({ name: 'Rest', sec, rest: true });
const sides = (name: string, sec: number, tip?: string): RStep[] => [ex(`${name}, left`, sec, tip), ex(`${name}, right`, sec, tip)];

export const ROUTINES: Routine[] = [
  {
    id: 'warmup',
    name: 'Dynamic warm-up',
    blurb: 'About 6 minutes. Wakes up legs and hips before a run.',
    steps: [
      ex('Easy walk', 60, 'Walk briskly and let your breathing settle.'),
      ...sides('Leg swings, front to back', 25, 'Hold something for balance and swing freely.'),
      ...sides('Leg swings, side to side', 25),
      ex('High knees', 30, 'Drive your knees up, stay tall.'),
      ex('Butt kicks', 30, 'Heels towards your glutes.'),
      ex('Walking lunges', 40, 'Long steps, upright chest.'),
      ex('A-skips', 30, 'Skip with a quick knee drive.'),
      ex('Ankle bounces', 30, 'Light and quick on the balls of your feet.'),
      ex('Easy jog in place', 30, 'Shake out your arms. You are ready.'),
    ],
  },
  {
    id: 'stretch',
    name: 'Post-run stretch',
    blurb: 'About 7 minutes. Calves, quads, hamstrings, hips and glutes.',
    steps: [
      ...sides('Calf stretch', 30, 'Heel down, lean into the wall.'),
      ...sides('Quad stretch', 30, 'Heel to glute, knees together.'),
      ...sides('Hamstring stretch', 30, 'Heel forward, hinge at the hips.'),
      ...sides('Hip flexor lunge', 30, 'Tuck your pelvis and push the hips forward.'),
      ...sides('Glute figure four', 30, 'Ankle over knee, sit back.'),
      ex("Child's pose", 40, 'Breathe slowly and relax your back.'),
    ],
  },
  {
    id: 'strength',
    name: 'Runner strength',
    blurb: 'About 10 minutes. Glutes, core and calves to run stronger and avoid injury.',
    steps: [
      ex('Squats', 40, 'Chest up, push your knees out.'), rest(),
      ...sides('Reverse lunges', 40, 'Step back, front knee over the ankle.'), rest(),
      ex('Glute bridges', 40, 'Squeeze at the top.'), rest(),
      ex('Plank', 40, 'Straight line from head to heels.'), rest(),
      ...sides('Side plank', 30, 'Lift your hips high.'), rest(),
      ex('Calf raises', 40, 'Slow up, slower down.'), rest(),
      ...sides('Single-leg balance', 30, 'Soft knee and level hips.'),
    ],
  },
];

export const routineSeconds = (r: Routine) => r.steps.reduce((a, s) => a + s.sec, 0);
