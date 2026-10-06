import AsyncStorage from '@react-native-async-storage/async-storage';
import { workoutMeters, workoutSeconds, type Step, type Workout } from './workouts';

// Adaptive coaching: the static plans in workouts.ts are a good default script, but they can't see
// how training is actually going. This module does: record how each completed plan session went
// (outcome), then scale the *next* one's volume up or down from the last few outcomes (adaptation)
// — never the authored plan data itself, so it's always reversible and the plan stays the source of
// truth. Pace zones already adapt on their own as VDOT improves (see CoachScreen's `paces`); this is
// the volume half of adaptive coaching, which nothing in the app did before.

export type SessionKind = 'long' | 'quality' | 'easy' | 'other';

// Plan session titles are authored consistently (see workouts.ts's `session()` helper, which puts
// the title on the Workout's `blurb`) — classifying by that text is simpler and more accurate here
// than trying to infer intent from the step shape.
export const classifyKind = (w: Workout): SessionKind => {
  const t = w.blurb.toLowerCase();
  if (/long run|time on feet/.test(t)) return 'long';
  if (/tempo|interval|hard|fartlek|marathon.pace|hill/.test(t)) return 'quality';
  if (/easy/.test(t)) return 'easy';
  return 'other';
};

export type SessionOutcome = {
  sessionId: string;
  kind: SessionKind;
  completedAt: number;
  completedAllSteps: boolean; // did the in-run coach engine report the workout finished, or was it cut short?
  targetSec: number; // the attempted workout's own planned total (already-adapted if it was adapted)
  targetM: number;
  actualSec: number; // the saved run's actual moving time / distance
  actualM: number;
  avgPaceSec: number | null;
  // The runner's easy-pace zone at the moment this session started (ZonePaces.easy). Running
  // much slower than the zone's *slow* end during any plan session — easy or not — is a clear
  // struggle signal. "Had room to spare" needs the much higher bar of beating even the zone's
  // *fast* end — most normal, on-track sessions land somewhere inside the zone, not past either
  // edge of it, so only a real edge crossing should move the needle either way.
  easyPaceSec: [number, number] | null;
};

const MAX_OUTCOMES = 8; // only the last few matter for "how's training going right now"
const WINDOW = 3; // how many recent outcomes computeAdaptation actually weighs

const key = (planId: string) => `runbutan.coachOutcomes.${planId}`;

export const loadOutcomes = async (planId: string): Promise<SessionOutcome[]> => {
  try {
    const raw = await AsyncStorage.getItem(key(planId));
    const list = raw ? (JSON.parse(raw) as SessionOutcome[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const recordOutcome = async (
  planId: string,
  sessionId: string,
  attemptedWorkout: Workout,
  run: { movingSec: number; distanceM: number; avgPaceSec: number | null },
  completedAllSteps: boolean,
  easyPaceSec: [number, number] | null,
): Promise<SessionOutcome[]> => {
  const outcome: SessionOutcome = {
    sessionId,
    kind: classifyKind(attemptedWorkout),
    completedAt: Date.now(),
    completedAllSteps,
    targetSec: workoutSeconds(attemptedWorkout),
    targetM: workoutMeters(attemptedWorkout),
    actualSec: run.movingSec,
    actualM: run.distanceM,
    avgPaceSec: run.avgPaceSec,
    easyPaceSec,
  };
  const existing = await loadOutcomes(planId);
  // Re-attempting the same session (e.g. after a short/discarded run) replaces its old outcome
  // rather than stacking both.
  const next = [...existing.filter((o) => o.sessionId !== sessionId), outcome].slice(-MAX_OUTCOMES);
  await AsyncStorage.setItem(key(planId), JSON.stringify(next));
  return next;
};

export type Adaptation = { factor: number; reason: string | null };

// A session "struggled" if it was cut short, fell well under its target distance/duration, or ran
// notably slower than the runner's own easy-pace ceiling (a quality or long session that *feels*
// like a slog is the clearest overreach signal there is). It "had room to spare" only when it was
// completed in full, at or past its target, comfortably inside/under the easy-pace ceiling.
// Long/quality sessions count double — overreaching on the week's hardest session is the real
// injury-risk signal; a single off easy run shouldn't swing the plan.
const WEIGHT: Record<SessionKind, number> = { long: 2, quality: 1.5, easy: 1, other: 1 };

export const computeAdaptation = (outcomes: SessionOutcome[]): Adaptation => {
  const recent = outcomes.slice(-WINDOW);
  if (recent.length === 0) return { factor: 1, reason: null };

  let score = 0; // negative = struggling lately, positive = had room to spare
  let strugglingKind: SessionKind | null = null;
  for (const o of recent) {
    const w = WEIGHT[o.kind];
    const achieved = o.targetM > 0 ? o.actualM / Math.max(1, o.targetM) : o.actualSec / Math.max(1, o.targetSec);
    // Pace is seconds/km: lower = faster. "Slower" compares against the zone's slow end (index 1),
    // "faster" against its fast end (index 0) — most normal sessions land between the two and
    // should trip neither.
    const slowerThanEasy = o.avgPaceSec !== null && o.easyPaceSec !== null && o.avgPaceSec > o.easyPaceSec[1] * 1.08;
    const fasterThanEasy = o.avgPaceSec !== null && o.easyPaceSec !== null && o.avgPaceSec < o.easyPaceSec[0] * 0.95;
    if (!o.completedAllSteps || achieved < 0.8 || slowerThanEasy) {
      score -= w;
      strugglingKind = strugglingKind ?? o.kind;
    } else if (achieved >= 1 && fasterThanEasy) {
      score += w;
    }
  }

  if (score <= -2.5) {
    const KIND_PLURAL: Record<SessionKind, string> = { long: 'long runs', quality: 'quality sessions', easy: 'easy runs', other: 'sessions' };
    const what = strugglingKind ? KIND_PLURAL[strugglingKind] : 'sessions';
    return { factor: 0.85, reason: `Eased 15% — your last few ${what} ran tougher than planned.` };
  }
  if (score < 0) {
    return { factor: 0.93, reason: 'Eased a little — your last session ran tougher than planned.' };
  }
  if (score >= 2.5) {
    return { factor: 1.12, reason: "Pushed 12% — you've had room to spare lately." };
  }
  if (score > 0) {
    return { factor: 1.06, reason: 'Nudged up slightly — that last session felt comfortable.' };
  }
  return { factor: 1, reason: null };
};

// Scales only the run/walk steps of a workout — warm-up, cool-down and recovery stay fixed length
// regardless, since they're not what training load actually means here. Returns the same
// object (not a copy) when there's nothing to change, so callers can cheaply check `=== workout`.
export const applyAdaptation = (workout: Workout, factor: number): Workout => {
  if (Math.abs(factor - 1) < 0.01) return workout;
  const scale = (s: Step): Step => {
    if (s.kind !== 'run' && s.kind !== 'walk') return s;
    if (s.sec !== undefined) return { ...s, sec: Math.max(20, Math.round((s.sec * factor) / 15) * 15) };
    if (s.meters !== undefined) return { ...s, meters: Math.max(100, Math.round((s.meters * factor) / 50) * 50) };
    return s;
  };
  return { ...workout, steps: workout.steps.map(scale) };
};
