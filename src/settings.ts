import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Unit = 'km' | 'mi';
export type Settings = {
  unit: Unit;
  announceSec: number; // how often the pace call-out repeats; 0 = only the per-km/mile splits
  sayPace: boolean;
  sayAvg: boolean;
  sayDist: boolean;
  sayTime: boolean;
  saySplits: boolean;
  voiceId: string | null; // null = automatic (first English voice)
  rate: number; // speech speed, 1 = normal
  duck: boolean; // lower the music while the coach speaks
};

export const DEFAULTS: Settings = {
  unit: 'km',
  announceSec: 30,
  sayPace: true,
  sayAvg: true,
  sayDist: true,
  sayTime: false,
  saySplits: true,
  voiceId: null,
  rate: 1,
  duck: true,
};

const KEY = 'runbutan.settings.v1';
let cur: Settings = { ...DEFAULTS };
const listeners = new Set<() => void>();

export const getSettings = () => cur;

export const loadSettings = async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) cur = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // keep defaults
  }
  listeners.forEach((l) => l());
};

export const updateSettings = (patch: Partial<Settings>) => {
  cur = { ...cur, ...patch };
  AsyncStorage.setItem(KEY, JSON.stringify(cur)).catch(() => {});
  listeners.forEach((l) => l());
};

// Re-renders the calling screen whenever a setting changes (so a unit switch updates every number at once).
export const useSettings = () => {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return cur;
};
