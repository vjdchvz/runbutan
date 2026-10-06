import AsyncStorage from '@react-native-async-storage/async-storage';

const PLAN = 'runbutan.plan';
export type PlanProgress = { planId: string; startedAt: number; done: string[] };

export const loadPlan = async (): Promise<PlanProgress | null> => {
  try {
    const raw = await AsyncStorage.getItem(PLAN);
    const p = raw ? (JSON.parse(raw) as PlanProgress) : null;
    return p && typeof p.planId === 'string' && Array.isArray(p.done) ? p : null;
  } catch {
    return null;
  }
};
export const savePlan = (p: PlanProgress | null) =>
  p ? AsyncStorage.setItem(PLAN, JSON.stringify(p)) : AsyncStorage.removeItem(PLAN);

export const markSessionDone = async (planId: string, sessionId: string) => {
  const cur = await loadPlan();
  const p: PlanProgress = cur && cur.planId === planId ? cur : { planId, startedAt: Date.now(), done: [] };
  if (!p.done.includes(sessionId)) p.done.push(sessionId);
  await savePlan(p);
  return p;
};

export const getNum = async (key: string): Promise<number | null> => {
  try {
    const v = await AsyncStorage.getItem(key);
    const n = v === null ? NaN : Number(v);
    return isFinite(n) ? n : null;
  } catch {
    return null;
  }
};
export const setNum = (key: string, n: number | null) =>
  n === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, String(n));

export const KEYS = { fiveK: 'runbutan.fiveK', age: 'runbutan.age', cadence: 'runbutan.cadence' };
