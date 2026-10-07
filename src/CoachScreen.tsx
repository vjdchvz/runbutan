import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { setBeatBpm, setBeatOn, useBeat } from './beat';
import { loadRuns, Run } from './history';
import { effortLabel } from './efforts';
import { fmtTime } from './session';
import { weeklyTotals } from './stats';
import { vdotFrom, zonesFor, predictSec, RACES, ZonePaces } from './coach/vdot';
import {
  paceFmt, PLANS, planById, planSessions, Plan, QUICK, Step, stepAmount, stepName, targetRange, Workout, workoutMeters, workoutSeconds, fmtMin,
} from './coach/workouts';
import { ROUTINES, routineSeconds, Routine } from './coach/routines';
import { getNum, KEYS, loadPlan, PlanProgress, savePlan, setNum } from './coach/store';
import { applyAdaptation, computeAdaptation, loadOutcomes, type SessionOutcome } from './coach/adapt';
import RoutineRunner from './RoutineRunner';
import { useDialog } from './Dialog';
import { updateSettings, useSettings } from './settings';
import { distText, paceLabel } from './units';

export type PlanCtx = { planId: string; sessionId: string };
type Props = { running: boolean; onStartWorkout: (w: Workout, ctx: PlanCtx | null, paces: ZonePaces | null) => void };
type ViewState = { t: 'home' } | { t: 'plan'; id: string } | { t: 'workout'; w: Workout; ctx: PlanCtx | null } | { t: 'routine'; r: Routine };

const TIPS = [
  'About 80% of your running should feel easy. Easy days make hard days possible.',
  'Sleep is training. Aim for 7 to 9 hours, especially after hard sessions.',
  'Aim for a quick, light stride, around 170 to 180 steps a minute, to avoid overstriding.',
  'Run tall: eyes ahead, shoulders relaxed, arms swinging gently.',
  'If you can not speak in short sentences, you are going too hard for an easy run.',
  'Drink water through the day, not only during the run.',
  'Warm up before hard sessions. Five minutes of easy movement makes a big difference.',
];

const compress = (steps: Step[]): string[] => {
  const key = (s: Step) => `${s.kind}|${s.sec ?? ''}|${s.meters ?? ''}|${s.zone ?? ''}|${s.label ?? ''}`;
  const text = (s: Step) => `${stepName(s)} ${stepAmount(s)}`;
  const out: string[] = [];
  let i = 0;
  while (i < steps.length) {
    let done = false;
    for (const L of [1, 2, 3]) {
      let k = 1;
      while (i + (k + 1) * L <= steps.length && steps.slice(i, i + L).every((s, j) => key(s) === key(steps[i + k * L + j]))) k++;
      if (k >= 2 && L <= 2) {
        out.push(`${k} × ${steps.slice(i, i + L).map(text).join(' / ')}`);
        i += k * L;
        done = true;
        break;
      }
    }
    if (!done) out.push(text(steps[i++]));
  }
  return out;
};

export default function CoachScreen({ running, onStartWorkout }: Props) {
  const st = useSettings(); // redraw when the unit changes
  const { dialog, showDialog } = useDialog();
  const [view, setView] = useState<ViewState>({ t: 'home' });
  const [runs, setRuns] = useState<Run[]>([]);
  const [progress, setProgress] = useState<PlanProgress | null>(null);
  const [outcomes, setOutcomes] = useState<SessionOutcome[]>([]);
  const [manual5k, setManual5k] = useState<number | null>(null);
  const [age, setAge] = useState(30);
  const { on: beat, bpm } = useBeat();

  const reload = useCallback(() => {
    loadRuns().then(setRuns);
    loadPlan().then(setProgress);
  }, []);
  useEffect(() => {
    reload();
    getNum(KEYS.fiveK).then(setManual5k);
    getNum(KEYS.age).then((v) => v && setAge(v));
    getNum(KEYS.cadence).then((v) => v && setBeatBpm(v));
  }, [reload]);
  // Adaptive coaching's input: how the last few sessions of the active plan actually went.
  useEffect(() => {
    if (!progress?.planId) {
      setOutcomes([]);
      return;
    }
    loadOutcomes(progress.planId).then(setOutcomes);
  }, [progress?.planId, progress?.done.length]);

  useEffect(() => {
    if (view.t === 'home') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setView({ t: 'home' });
      return true;
    });
    return () => sub.remove();
  }, [view.t]);


  // ---- pace zones from your best effort (or a 5K time you set) ----
  let auto: { vdot: number; label: string } | null = null;
  for (const r of runs) {
    for (const e of r.efforts ?? []) {
      if (e.d < 2000 || e.d > 21097) continue;
      if (e.s / (e.d / 1000) < 140) continue; // faster than 2:20/km over 2 km+ beats every world record: a GPS glitch, not a run
      const v = Math.min(80, vdotFrom(e.d, e.s));
      if (!auto || v > auto.vdot) auto = { vdot: v, label: `your best ${effortLabel(e.d)} (${fmtTime(e.s)})` };
    }
  }
  const base = manual5k !== null ? vdotFrom(5000, manual5k) : auto ? auto.vdot : vdotFrom(5000, 1800);
  const info = {
    vdot: base,
    label: manual5k !== null ? `a 5 km time of ${fmtTime(manual5k)}` : auto ? auto.label : 'an estimated 5 km time of 30:00 (set yours below)',
  };
  const fiveK = manual5k ?? Math.round(predictSec(base, 5000)); // what the stepper shows: your 5K now
  const paces = zonesFor(info.vdot);

  const changeFiveK = (d: number) => {
    const n = Math.max(900, Math.min(3600, fiveK + d));
    setManual5k(n);
    setNum(KEYS.fiveK, n);
  };
  const changeAge = (d: number) => {
    const n = Math.max(12, Math.min(90, age + d));
    setAge(n);
    setNum(KEYS.age, n);
  };
  const weightKg = st.weightKg;
  const changeWeight = (d: number) => {
    const n = Math.max(30, Math.min(200, (weightKg ?? 70) + (weightKg ? d : 0)));
    updateSettings({ weightKg: n });
  };
  const changeBpm = (d: number) => {
    const n = Math.max(140, Math.min(200, bpm + d));
    setBeatBpm(n);
    setNum(KEYS.cadence, n);
  };

  // ---- today's session + weekly advice ----
  const plan = progress ? planById(progress.planId) : undefined;
  const nextSession = plan ? planSessions(plan).find((s) => !progress!.done.includes(s.id)) : undefined;
  // Adaptive coaching (coach/adapt.ts): eases or pushes only the very next undone session, from
  // how the last few sessions of *this* plan actually went. Every other week stays exactly as
  // authored — it gets its own fresh adaptation once it's actually next, not a guess made now.
  const adaptation = st.adaptiveCoaching ? computeAdaptation(outcomes) : { factor: 1, reason: null };
  const nextWorkout = nextSession ? applyAdaptation(nextSession.workout, adaptation.factor) : null;
  const startPlan = (p: Plan) => {
    const begin = () => {
      const np = { planId: p.id, startedAt: Date.now(), done: [] };
      setProgress(np);
      savePlan(np);
      setView({ t: 'plan', id: p.id });
    };
    if (plan && progress && progress.planId !== p.id && progress.done.length > 0) {
      showDialog({
        title: 'Switch plan?',
        highlight: `${progress.done.length} of ${planSessions(plan).length} done`,
        message: `Starting ${p.name} replaces your progress in ${plan.name}.`,
        confirmLabel: 'SWITCH',
        cancelLabel: 'KEEP MINE',
        danger: true,
        onConfirm: begin,
      });
    } else begin();
  };

  const weeks = weeklyTotals(runs, 4);
  const thisKm = weeks[3].distanceM / 1000, lastKm = weeks[2].distanceM / 1000;
  const tip =
    runs.length === 0
      ? 'Welcome! Pick a plan below and let the voice coach guide your first run.'
      : lastKm > 0 && thisKm > lastKm * 1.1
        ? `Your distance is up ${Math.round((thisKm / lastKm - 1) * 100)}% on last week. Keep weekly increases under about 10% to stay injury-free.`
        : weeks[3].runs === 0 && lastKm > 0
          ? 'No run yet this week. Even an easy 20 minutes keeps your streak and your fitness going.'
          : TIPS[Math.floor(Date.now() / 86400000) % TIPS.length];

  const start = (w: Workout, ctx: PlanCtx | null) => onStartWorkout(w, ctx, paces);

  // ---- sub-screens ----
  if (view.t === 'routine') return <RoutineRunner routine={view.r} onExit={() => setView({ t: 'home' })} />;

  if (view.t === 'workout') {
    const w = view.w;
    return (
      <ScrollView style={styles.root} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12, gap: 12 }}>
        <Pressable onPress={() => setView(view.ctx ? { t: 'plan', id: view.ctx.planId } : { t: 'home' })} hitSlop={12}>
          <Text style={styles.back}>‹ BACK</Text>
        </Pressable>
        <Text style={styles.title}>{w.name}</Text>
        <Text style={styles.hint}>{w.blurb}</Text>
        <View style={styles.row}>
          <Stat label="TIME" value={`~${Math.round(workoutSeconds(w) / 60)} min`} />
          <Stat label="PARTS" value={String(w.steps.length)} />
          {workoutMeters(w) > 0 && <Stat label="DISTANCE" value={distText(workoutMeters(w), 1)} />}
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>STRUCTURE</Text>
          {compress(w.steps).map((l, i) => <Text key={i} style={styles.line}>{l}</Text>)}
          {w.steps.some((s) => targetRange(s, paces)) && <Text style={[styles.hint, { marginTop: 10 }]}>Hard parts use your pace zones, e.g. tempo {paceFmt(paces.tempo)} {paceLabel()}.</Text>}
        </View>
        <Text style={styles.hint}>🔊 The voice coach announces every part, counts you down and tells you when to speed up or ease off. Keep voice call-outs on.</Text>
        <Pressable style={[styles.btn, running && styles.btnOff]} disabled={running} onPress={() => start(w, view.ctx)}>
          <Text style={styles.btnText}>{running ? 'FINISH YOUR CURRENT RUN FIRST' : 'START WORKOUT'}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (view.t === 'plan') {
    const dlg = dialog;
    const p = planById(view.id)!;
    const done = progress?.planId === p.id ? progress.done : [];
    const total = planSessions(p).length;
    return (
      <ScrollView style={styles.root} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12, gap: 12 }}>
        <Pressable onPress={() => setView({ t: 'home' })} hitSlop={12}><Text style={styles.back}>‹ COACH</Text></Pressable>
        <Text style={styles.title}>{p.name}</Text>
        <Text style={styles.hint}>{p.blurb}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${(done.length / total) * 100}%` }]} /></View>
        <Text style={styles.hint}>{done.length} of {total} sessions done</Text>
        {p.weeks.map((wk, wi) => (
          <View key={wi} style={styles.card}>
            <Text style={styles.label}>WEEK {wi + 1}</Text>
            {wk.map((s) => {
              // Only the one session that's actually next gets today's adaptation; every other
              // row shows the plan exactly as authored, since its own adaptation only happens
              // once it's actually reached.
              const isNext = p.id === plan?.id && s.id === nextSession?.id;
              const displayWorkout = isNext && nextWorkout ? nextWorkout : s.workout;
              return (
              <Pressable key={s.id} style={styles.sessionRow} onPress={() => setView({ t: 'workout', w: displayWorkout, ctx: { planId: p.id, sessionId: s.id } })}>
                <Text style={[styles.check, done.includes(s.id) && styles.checkOn]}>{done.includes(s.id) ? '✓' : '○'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.line}>{s.workout.name.replace(/^Week \d+ · /, '')} · {s.title}</Text>
                  <Text style={styles.hint2}>~{Math.round(workoutSeconds(displayWorkout) / 60)} min{isNext && adaptation.reason ? ' · adjusted' : ''}</Text>
                </View>
                <Text style={styles.chev}>›</Text>
              </Pressable>
              );
            })}
          </View>
        ))}
        <Pressable
          onPress={() =>
            showDialog({
              title: 'Leave this plan?',
              message: 'Your progress in this plan will be cleared.',
              confirmLabel: 'LEAVE PLAN',
              cancelLabel: 'KEEP',
              danger: true,
              onConfirm: () => {
                setProgress(null);
                savePlan(null);
                setView({ t: 'home' });
              },
            })
          }
          style={{ alignItems: 'center', padding: 10 }}
        >
          <Text style={styles.deleteText}>Leave this plan</Text>
        </Pressable>
        {dlg}
      </ScrollView>
    );
  }

  // ---- home ----
  return (
    <ScrollView style={styles.root} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 12 }}>
      {dialog}
      <View style={[styles.card, styles.tip]}>
        <Text style={styles.label}>COACH SAYS</Text>
        <Text style={styles.tipText}>{tip}</Text>
      </View>

      {plan && nextSession && nextWorkout ? (
        <View style={styles.card}>
          <Text style={styles.label}>TODAY · {plan.name.toUpperCase()}</Text>
          <Text style={styles.big}>{nextSession.workout.name}</Text>
          <Text style={styles.hint}>{nextSession.title} · ~{Math.round(workoutSeconds(nextWorkout) / 60)} min</Text>
          {adaptation.reason && <Text style={styles.adapted}>🤖 {adaptation.reason}</Text>}
          <Pressable style={styles.btn} onPress={() => setView({ t: 'workout', w: nextWorkout, ctx: { planId: plan.id, sessionId: nextSession.id } })}>
            <Text style={styles.btnText}>OPEN SESSION</Text>
          </Pressable>
          <Pressable onPress={() => setView({ t: 'plan', id: plan.id })} style={{ alignItems: 'center', paddingTop: 12 }}>
            <Text style={styles.link}>View full plan</Text>
          </Pressable>
        </View>
      ) : plan ? (
        <View style={styles.card}><Text style={styles.big}>🎉 Plan complete!</Text><Text style={styles.hint}>You finished {plan.name}. Pick your next challenge below.</Text></View>
      ) : null}

      <Text style={styles.section}>TRAINING PLANS</Text>
      {PLANS.map((p) => (
        <Pressable key={p.id} style={styles.card} onPress={() => (progress?.planId === p.id ? setView({ t: 'plan', id: p.id }) : startPlan(p))}>
          <View style={styles.rowBetween}>
            <Text style={styles.big}>{p.name}</Text>
            <Text style={styles.badge}>{p.level.toUpperCase()}</Text>
          </View>
          <Text style={styles.hint}>{p.blurb}</Text>
          <Text style={styles.link}>{progress?.planId === p.id ? `Continue · ${progress.done.length}/${planSessions(p).length} done` : 'Start this plan ›'}</Text>
        </Pressable>
      ))}

      <Text style={styles.section}>QUICK WORKOUTS</Text>
      {QUICK.map((w) => (
        <Pressable key={w.id} style={styles.card} onPress={() => setView({ t: 'workout', w, ctx: null })}>
          <View style={styles.rowBetween}>
            <Text style={styles.name}>{w.name}</Text>
            <Text style={styles.badge}>{w.level.toUpperCase()}</Text>
          </View>
          <Text style={styles.hint}>{w.blurb}</Text>
        </Pressable>
      ))}

      <Text style={styles.section}>YOUR PACES</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>Based on {info.label}.</Text>
        {([
          ['Easy', `${paceFmt(paces.easy[0])}–${paceFmt(paces.easy[1])}`, 'Most of your running'],
          ['Marathon', paceFmt(paces.marathon), 'Steady, long-run effort'],
          ['Tempo', paceFmt(paces.tempo), 'Comfortably hard'],
          ['Interval', paceFmt(paces.interval), 'Hard repeats'],
          ['Repetition', paceFmt(paces.rep), 'Fast, short strides'],
        ] as const).map(([n, p, d]) => (
          <View key={n} style={styles.zoneRow}>
            <View><Text style={styles.line}>{n}</Text><Text style={styles.hint2}>{d}</Text></View>
            <Text style={styles.zone}>{p} {paceLabel()}</Text>
          </View>
        ))}
        <View style={styles.stepRow}>
          <Text style={styles.line}>My 5 km time</Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => changeFiveK(-15)} style={styles.stepBtn} hitSlop={8}><Text style={styles.stepText}>−</Text></Pressable>
            <Text style={styles.stepVal}>{fmtTime(fiveK)}</Text>
            <Pressable onPress={() => changeFiveK(15)} style={styles.stepBtn} hitSlop={8}><Text style={styles.stepText}>+</Text></Pressable>
          </View>
        </View>
        {manual5k !== null && auto && (
          <Pressable onPress={() => { setManual5k(null); setNum(KEYS.fiveK, null); }}><Text style={styles.link}>Use my best effort instead</Text></Pressable>
        )}
      </View>

      <Text style={styles.section}>RACE PREDICTOR</Text>
      <View style={styles.card}>
        {RACES.map((r) => (
          <View key={r.label} style={styles.zoneRow}>
            <Text style={styles.line}>{r.label}</Text>
            <Text style={styles.zone}>{fmtTime(predictSec(info.vdot, r.m))}</Text>
          </View>
        ))}
        <Text style={styles.hint2}>An estimate for a fully trained runner. Long races need long-run training.</Text>
      </View>

      <Text style={styles.section}>GUIDED ROUTINES · VOICE</Text>
      {ROUTINES.map((r) => (
        <Pressable key={r.id} style={styles.card} onPress={() => setView({ t: 'routine', r })}>
          <View style={styles.rowBetween}>
            <Text style={styles.name}>{r.name}</Text>
            <Text style={styles.badge}>{Math.round(routineSeconds(r) / 60)} MIN</Text>
          </View>
          <Text style={styles.hint}>{r.blurb}</Text>
        </Pressable>
      ))}

      <Text style={styles.section}>TOOLS</Text>
      <View style={styles.card}>
        <Text style={styles.label}>CADENCE BEAT</Text>
        <Text style={styles.hint}>A gentle vibration on every step, to keep a steady stride (about 170–180 is common). Keeps going with the screen off; pauses with your run.</Text>
        <View style={styles.stepRow}>
          <View style={styles.stepper}>
            <Pressable onPress={() => changeBpm(-2)} style={styles.stepBtn} hitSlop={8}><Text style={styles.stepText}>−</Text></Pressable>
            <Text style={styles.stepVal}>{bpm} spm</Text>
            <Pressable onPress={() => changeBpm(2)} style={styles.stepBtn} hitSlop={8}><Text style={styles.stepText}>+</Text></Pressable>
          </View>
          <Pressable style={[styles.pill, beat && styles.pillOn]} onPress={() => setBeatOn(!beat)}>
            <Text style={styles.btnText}>{beat ? 'STOP BEAT' : 'START BEAT'}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>BODY WEIGHT</Text>
        <Text style={styles.hint}>Used to work out calories burned on every run (pace, distance and hills are counted too).</Text>
        <View style={styles.stepRow}>
          <Text style={styles.line}>My weight</Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => changeWeight(-1)} onLongPress={() => changeWeight(-5)} style={styles.stepBtn} hitSlop={8}><Text style={styles.stepText}>−</Text></Pressable>
            <Text style={styles.stepVal}>{weightKg ? `${weightKg} kg` : 'not set'}</Text>
            <Pressable onPress={() => changeWeight(1)} onLongPress={() => changeWeight(5)} style={styles.stepBtn} hitSlop={8}><Text style={styles.stepText}>+</Text></Pressable>
          </View>
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>HEART RATE ZONES</Text>
        <View style={styles.stepRow}>
          <Text style={styles.line}>My age</Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => changeAge(-1)} style={styles.stepBtn} hitSlop={8}><Text style={styles.stepText}>−</Text></Pressable>
            <Text style={styles.stepVal}>{age}</Text>
            <Pressable onPress={() => changeAge(1)} style={styles.stepBtn} hitSlop={8}><Text style={styles.stepText}>+</Text></Pressable>
          </View>
        </View>
        {([['Zone 1 · very easy', 0.5, 0.6], ['Zone 2 · easy', 0.6, 0.7], ['Zone 3 · steady', 0.7, 0.8], ['Zone 4 · hard', 0.8, 0.9], ['Zone 5 · max', 0.9, 1]] as const).map(([n, a, b]) => (
          <View key={n} style={styles.zoneRow}>
            <Text style={styles.line}>{n}</Text>
            <Text style={styles.zone}>{Math.round((220 - age) * a)}–{Math.round((220 - age) * b)} bpm</Text>
          </View>
        ))}
        <Text style={styles.hint2}>Estimate from 220 − age. For a watch or chest strap, use its own zones.</Text>
      </View>
    </ScrollView>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={{ flex: 1 }}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, marginTop: 4 },
  card: { backgroundColor: '#17171F', borderRadius: 18, padding: 16 },
  tip: { borderLeftWidth: 4, borderLeftColor: '#FF4D2E' },
  tipText: { color: '#fff', fontSize: 15, lineHeight: 22, marginTop: 6, fontWeight: '600' },
  label: { color: '#8A8A96', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  section: { color: '#8A8A96', fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginTop: 6 },
  title: { color: '#fff', fontSize: 26, fontWeight: '900' },
  big: { color: '#fff', fontSize: 20, fontWeight: '900', marginTop: 4 },
  name: { color: '#fff', fontSize: 17, fontWeight: '800' },
  hint: { color: '#8A8A96', fontSize: 13, lineHeight: 19, marginTop: 4 },
  hint2: { color: '#6A6A76', fontSize: 12, marginTop: 2 },
  line: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 6 },
  link: { color: '#FF4D2E', fontWeight: '800', marginTop: 10, fontSize: 13 },
  adapted: { color: '#E0B020', fontSize: 12, fontWeight: '700', marginTop: 8 },
  back: { color: '#FF4D2E', fontWeight: '800', letterSpacing: 1.5, marginTop: 14 },
  badge: { color: '#8A8A96', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, backgroundColor: '#22222C', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 2 },
  btn: { backgroundColor: '#FF4D2E', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 14 },
  btnOff: { backgroundColor: '#3A3A46' },
  btnText: { color: '#fff', fontWeight: '900', letterSpacing: 1.1, fontSize: 13 },
  track: { height: 8, borderRadius: 4, backgroundColor: '#26262F', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: '#FF4D2E' },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#26262F', marginTop: 6 },
  check: { color: '#55555F', fontSize: 20, width: 24, textAlign: 'center' },
  checkOn: { color: '#3CB043', fontWeight: '900' },
  chev: { color: '#55555F', fontSize: 24 },
  deleteText: { color: '#8A8A96', fontWeight: '700' },
  zoneRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#26262F', marginTop: 4 },
  zone: { color: '#FF4D2E', fontWeight: '900', fontSize: 16, fontVariant: ['tabular-nums'] },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#2A2A35', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: -2 },
  stepVal: { color: '#fff', fontSize: 16, fontWeight: '800', minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  pill: { backgroundColor: '#2A2A35', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  pillOn: { backgroundColor: '#E02030' },
});
