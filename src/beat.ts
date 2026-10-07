import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { startBeat as nativeStart, stopBeat as nativeStop } from '../modules/runkit';

// Cadence beat, app-wide: it keeps going when you switch tabs, lock the phone or leave the app,
// because the vibration pattern is repeated by Android itself (see RunKitModule.startBeat).
// A run pauses it while paused and turns it off when the run ends.
let on = false;
let held = false; // run is paused: beat stays "on" but silent
let bpm = 170;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// iOS has no repeating vibration pattern: tap the haptic engine on a timer instead. iOS only plays
// haptics while the app is in the foreground, so on iPhone the beat runs with the screen on.
let iosTimer: ReturnType<typeof setInterval> | null = null;
const startBeat = (v: number) => {
  if (Platform.OS !== 'ios') return nativeStart(v);
  if (iosTimer) clearInterval(iosTimer);
  iosTimer = setInterval(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, 60000 / v);
  return true;
};
const stopBeat = () => {
  if (Platform.OS !== 'ios') return nativeStop();
  if (iosTimer) clearInterval(iosTimer);
  iosTimer = null;
};
export const beatWorksInBackground = Platform.OS !== 'ios';

const apply = () => (on && !held ? startBeat(bpm) : stopBeat());

export const isBeatOn = () => on;
export const setBeatOn = (v: boolean) => {
  on = v;
  apply();
  emit();
};
export const setBeatBpm = (v: number) => {
  bpm = v;
  if (on && !held) startBeat(bpm);
  emit();
};
export const holdBeat = (v: boolean) => {
  if (held === v) return;
  held = v;
  apply();
};

export const useBeat = () => {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { on, bpm };
};
