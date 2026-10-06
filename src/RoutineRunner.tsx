import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { sayCoach, fmtTime, stopSpeech } from './session';
import type { Routine } from './coach/routines';

// Timer-driven guided routine. The coach announces each exercise, counts down, and says when it's done.
export default function RoutineRunner({ routine, onExit }: { routine: Routine; onExit: () => void }) {
  const [i, setI] = useState(-1); // -1 = ready screen
  const [left, setLeft] = useState(0);
  const [paused, setPaused] = useState(false);
  const idx = useRef(-1);
  const rem = useRef(0);

  const begin = (n: number) => {
    const s = routine.steps[n];
    idx.current = n;
    rem.current = s.sec;
    setI(n);
    setLeft(s.sec);
    const next = routine.steps[n + 1];
    sayCoach(`${s.rest ? 'Rest' : s.name}. ${s.sec} seconds. ${s.tip ?? ''}${s.rest && next ? ` Next: ${next.name}.` : ''}`, true);
  };

  useEffect(() => {
    if (i < 0 || paused) return;
    activateKeepAwakeAsync('routine');
    const id = setInterval(() => {
      if (idx.current >= routine.steps.length) return; // routine already finished: nothing left to tick
      rem.current -= 1;
      setLeft(rem.current);
      const s = routine.steps[idx.current];
      if (rem.current === 10 && s.sec >= 30) sayCoach('Ten seconds.');
      if (rem.current === 3) sayCoach('Three, two, one.');
      if (rem.current <= 0) {
        if (idx.current + 1 >= routine.steps.length) {
          sayCoach(`${routine.name} complete. Nice work!`, true);
          idx.current = routine.steps.length;
          setI(routine.steps.length);
        } else begin(idx.current + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [i >= 0, paused]);

  useEffect(
    () => () => {
      deactivateKeepAwake('routine');
      stopSpeech(); // leaving mid-routine must not leave the coach talking
    },
    [],
  );

  const total = routine.steps.length;
  const done = i >= total;
  const s = i >= 0 && !done ? routine.steps[i] : null;

  return (
    <View style={styles.root}>
      <Pressable onPress={onExit} hitSlop={12}><Text style={styles.back}>‹ COACH</Text></Pressable>
      <Text style={styles.title}>{routine.name}</Text>
      {i < 0 && (
        <>
          <Text style={styles.hint}>{routine.blurb}</Text>
          <Text style={styles.hint}>{total} steps · the voice coach tells you what to do and when to switch.</Text>
          <Pressable style={styles.btn} onPress={() => begin(0)}><Text style={styles.btnText}>START</Text></Pressable>
        </>
      )}
      {s && (
        <View style={styles.card}>
          <Text style={styles.step}>{s.rest ? 'REST' : `STEP ${i + 1} OF ${total}`}</Text>
          <Text style={styles.name}>{s.name}</Text>
          <Text style={styles.time}>{fmtTime(Math.max(0, left))}</Text>
          {!!s.tip && <Text style={styles.hint}>{s.tip}</Text>}
          <View style={styles.track}><View style={[styles.fill, { width: `${((i + (1 - left / s.sec)) / total) * 100}%` }]} /></View>
          <View style={styles.row}>
            <Pressable style={[styles.btn2]} onPress={() => setPaused((p) => !p)}><Text style={styles.btnText}>{paused ? 'RESUME' : 'PAUSE'}</Text></Pressable>
            <Pressable style={styles.btn2} onPress={() => (i + 1 >= total ? (idx.current = total, setI(total)) : begin(i + 1))}><Text style={styles.btnText}>SKIP</Text></Pressable>
          </View>
        </View>
      )}
      {done && (
        <View style={styles.card}>
          <Text style={styles.name}>🎉 Complete!</Text>
          <Text style={styles.hint}>Nice work. Take a drink of water.</Text>
          <Pressable style={styles.btn} onPress={onExit}><Text style={styles.btnText}>DONE</Text></Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  back: { color: '#FF4D2E', fontWeight: '800', letterSpacing: 1.5, marginTop: 14 },
  title: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 8 },
  hint: { color: '#8A8A96', fontSize: 14, marginTop: 8, lineHeight: 20 },
  card: { backgroundColor: '#17171F', borderRadius: 20, padding: 20, marginTop: 18 },
  step: { color: '#FF4D2E', fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  name: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 6 },
  time: { color: '#fff', fontSize: 72, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: '#26262F', marginTop: 16, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: '#FF4D2E' },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { backgroundColor: '#FF4D2E', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  btn2: { flex: 1, backgroundColor: '#2A2A35', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '900', letterSpacing: 1.2 },
});
