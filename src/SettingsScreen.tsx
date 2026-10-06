import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import { speakTest } from './session';
import { getSettings, Settings, updateSettings, useSettings } from './settings';

const INTERVALS = [
  { label: 'Off', v: 0 },
  { label: '15 s', v: 15 },
  { label: '30 s', v: 30 },
  { label: '1 min', v: 60 },
  { label: '2 min', v: 120 },
  { label: '5 min', v: 300 },
];

type V = { identifier: string; name: string; language: string };
const isOnline = (v: V) => /network/i.test(v.name) || (v as { networkConnectionRequired?: boolean }).networkConnectionRequired === true;
const nice = (v: V, n: number) => {
  const g = /#(male|female)_(\d+)/i.exec(v.name);
  const code = /-x-([a-z0-9]+)/i.exec(v.name)?.[1];
  return `${v.language} · voice ${n}${g ? ` · ${g[1]}` : code ? ` · ${code}` : ''}${isOnline(v) ? ' · needs internet' : ' · works offline'}`;
};

export default function SettingsScreen({ onBack, muted }: { onBack: () => void; muted: boolean }) {
  const st = useSettings();
  const [voices, setVoices] = useState<V[]>([]);
  useEffect(() => {
    Speech.getAvailableVoicesAsync()
      .then((all) => {
        const en = all.filter((v) => v.language?.toLowerCase().startsWith('en')) as V[];
        // offline voices first (they work with no signal), then US English first, then by name
        en.sort((a, b) => Number(isOnline(a)) - Number(isOnline(b)) || Number(/en-us/i.test(b.language)) - Number(/en-us/i.test(a.language)) || a.identifier.localeCompare(b.identifier));
        setVoices(en);
      })
      .catch(() => {});
  }, []);

  const toggle = (k: keyof Settings) => updateSettings({ [k]: !getSettings()[k] } as Partial<Settings>);
  const rows: [keyof Settings, string][] = [
    ['sayPace', 'Current pace'],
    ['sayAvg', 'Average pace'],
    ['sayDist', 'Distance'],
    ['sayTime', 'Time'],
    ['saySplits', `Split at every ${st.unit === 'mi' ? 'mile' : 'kilometer'}`],
  ];

  return (
    <ScrollView style={styles.root} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 16 }}>
      <Pressable onPress={onBack} hitSlop={12}><Text style={styles.back}>‹ BACK</Text></Pressable>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.label}>UNITS</Text>
        <View style={styles.seg}>
          {(['km', 'mi'] as const).map((u) => (
            <Pressable key={u} style={[styles.segBtn, st.unit === u && styles.segOn]} onPress={() => updateSettings({ unit: u })}>
              <Text style={[styles.segText, st.unit === u && styles.segTextOn]}>{u === 'km' ? 'Kilometers' : 'Miles'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>Changes distances, paces, splits and the voice. Best-effort distances and training plans stay in km.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>HOW OFTEN THE VOICE SPEAKS</Text>
        <View style={styles.chips}>
          {INTERVALS.map((o) => (
            <Pressable key={o.v} style={[styles.chip, st.announceSec === o.v && styles.chipOn]} onPress={() => updateSettings({ announceSec: o.v })}>
              <Text style={[styles.chipText, st.announceSec === o.v && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          {st.announceSec === 0 ? 'Only the split call-outs will speak.' : `Pace, average and distance are read out every ${INTERVALS.find((o) => o.v === st.announceSec)?.label ?? `${st.announceSec} s`}.`} Guided workouts speak their own cues.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>WHAT THE VOICE READS OUT</Text>
        {rows.map(([k, name]) => (
          <View key={k} style={styles.switchRow}>
            <Text style={styles.line}>{name}</Text>
            <Switch value={st[k] as boolean} onValueChange={() => toggle(k)} trackColor={{ false: '#3A3A46', true: '#FF4D2E' }} thumbColor="#fff" />
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>VOICE</Text>
        <View style={styles.switchRow}>
          <Text style={styles.line}>Speed</Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => updateSettings({ rate: Math.max(0.6, +(st.rate - 0.1).toFixed(1)) })} style={styles.stepBtn} hitSlop={8}><Text style={styles.stepText}>−</Text></Pressable>
            <Text style={styles.stepVal}>{st.rate.toFixed(1)}×</Text>
            <Pressable onPress={() => updateSettings({ rate: Math.min(1.6, +(st.rate + 0.1).toFixed(1)) })} style={styles.stepBtn} hitSlop={8}><Text style={styles.stepText}>+</Text></Pressable>
          </View>
        </View>
        <Pressable style={styles.test} onPress={speakTest}>
          <Text style={styles.testText}>▶ TEST VOICE</Text>
        </Pressable>
        {muted && <Text style={styles.warn}>Voice is muted on the RUN screen. Turn it on to hear this.</Text>}

        <Pressable style={[styles.voiceRow, st.voiceId === null && styles.voiceOn]} onPress={() => { updateSettings({ voiceId: null }); speakTest(); }}>
          <Text style={styles.line}>Automatic (recommended)</Text>
          {st.voiceId === null && <Text style={styles.tick}>✓</Text>}
        </Pressable>
        {voices.map((v, i) => (
          <Pressable key={v.identifier} style={[styles.voiceRow, st.voiceId === v.identifier && styles.voiceOn]} onPress={() => { updateSettings({ voiceId: v.identifier }); speakTest(); }}>
            <Text style={styles.line}>{nice(v, i + 1)}</Text>
            {st.voiceId === v.identifier && <Text style={styles.tick}>✓</Text>}
          </Pressable>
        ))}
        {voices.length === 0 && <Text style={styles.hint}>No extra English voices found. Install more in your phone's text-to-speech settings.</Text>}
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.line}>Lower music while the voice speaks</Text>
            <Text style={styles.hint}>Your music gets quieter for a moment, then comes back.</Text>
          </View>
          <Switch value={st.duck} onValueChange={() => toggle('duck')} trackColor={{ false: '#3A3A46', true: '#FF4D2E' }} thumbColor="#fff" />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>LOCK SCREEN</Text>
        <Text style={styles.hint}>While you run, the notification shows time, distance and pace with Pause and Stop buttons. Press Stop twice to finish, so a stray tap in your pocket can not end the run. If you do not see it, allow notifications for RUNbutan in your phone settings.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, marginTop: 4 },
  card: { backgroundColor: '#17171F', borderRadius: 18, padding: 16 },
  back: { color: '#FF4D2E', fontWeight: '800', letterSpacing: 1.5, marginTop: 14 },
  title: { color: '#fff', fontSize: 26, fontWeight: '900' },
  label: { color: '#8A8A96', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  hint: { color: '#8A8A96', fontSize: 13, lineHeight: 19, marginTop: 8 },
  warn: { color: '#E0B020', fontSize: 13, marginTop: 8 },
  line: { color: '#fff', fontSize: 15, fontWeight: '700' },
  seg: { flexDirection: 'row', gap: 8, marginTop: 10 },
  segBtn: { flex: 1, backgroundColor: '#22222C', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  segOn: { backgroundColor: '#FF4D2E' },
  segText: { color: '#8A8A96', fontWeight: '800' },
  segTextOn: { color: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { backgroundColor: '#22222C', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipOn: { backgroundColor: '#FF4D2E' },
  chipText: { color: '#8A8A96', fontWeight: '800', fontSize: 13 },
  chipTextOn: { color: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#2A2A35', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: -2 },
  stepVal: { color: '#fff', fontSize: 16, fontWeight: '800', minWidth: 52, textAlign: 'center' },
  test: { backgroundColor: '#2A2A35', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  testText: { color: '#fff', fontWeight: '900', letterSpacing: 1.1, fontSize: 13 },
  voiceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10, marginTop: 6, backgroundColor: '#1D1D26' },
  voiceOn: { borderWidth: 1, borderColor: '#FF4D2E' },
  tick: { color: '#FF4D2E', fontWeight: '900', fontSize: 16 },
});
