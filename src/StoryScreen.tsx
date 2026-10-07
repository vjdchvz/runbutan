import { useEffect, useRef, useState } from 'react';
import { BackHandler, Image, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { saveImageToGallery } from '../modules/runkit';
import { badgeText, isEffortDistance } from './efforts';
import type { DialogOptions } from './Dialog';
import type { Run } from './history';
import RouteMap from './RouteMap';
import { fmtPace, fmtTime, TrackPt } from './session';
import { useSettings } from './settings';
import { runTitle } from './stats';
import { distNum, paceLabel, unitName } from './units';

// A 9:16 "story" card: the route map plus the run's numbers. What you see here is exactly what gets shared.
type Look = 'map' | 'dark';

const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export default function StoryScreen({ run, track, onBack, onDialog }: { run: Run; track: TrackPt[]; onBack: () => void; onDialog: (o: DialogOptions) => void }) {
  useSettings(); // redraw if the unit changes
  const [look, setLook] = useState<Look>('map');
  const [mapReady, setMapReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const card = useRef<View>(null);
  const { width: sw, height: sh } = useWindowDimensions();

  // Preview size: 9:16, as large as fits above the buttons.
  const cw = Math.min(sw - 80, ((sh - 420) * 9) / 16);
  const ch = (cw * 16) / 9;
  const u = cw / 360; // everything inside the card scales with this

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  // The street map needs its tiles; offline it can only use ones already saved, so stop waiting after a few seconds.
  useEffect(() => {
    setMapReady(look === 'dark');
    if (look === 'dark') return;
    const id = setTimeout(() => setMapReady(true), 5000);
    return () => clearTimeout(id);
  }, [look]);

  const render = async () => {
    if (!card.current) throw new Error('The card is not ready yet');
    return captureRef(card, { format: 'png', quality: 1, width: 1080, height: 1920, result: 'tmpfile' });
  };

  const share = async () => {
    setBusy(true);
    try {
      const uri = await render();
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your run' });
    } catch (e) {
      onDialog({ title: 'RUNbutan', message: e instanceof Error ? e.message : 'Could not create the image', confirmLabel: 'OK' });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    // iOS: the share sheet's "Save Image" puts it straight into Photos (no extra permission needed).
    if (Platform.OS === 'ios') return share();
    setBusy(true);
    try {
      const uri = await render();
      const d = new Date(run.startedAt);
      const p = (n: number) => String(n).padStart(2, '0');
      const name = `runbutan-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${Date.now() % 100000}.png`;
      await saveImageToGallery(uri, name);
      onDialog({ title: 'Saved', message: `${name}\n\nSaved to your gallery in the "RUNbutan" album, ready to post as a story.`, confirmLabel: 'OK' });
    } catch (e) {
      onDialog({ title: "Couldn't save", message: e instanceof Error ? e.message : 'Saving the image failed.', confirmLabel: 'OK' });
    } finally {
      setBusy(false);
    }
  };

  const badge = [...(run.badges ?? [])].filter((b) => isEffortDistance(b.d)).sort((a, b) => a.rank - b.rank || b.d - a.d)[0];
  const stat = (label: string, value: string) => (
    <View style={{ flex: 1 }}>
      <Text style={[styles.label, { fontSize: 11 * u }]}>{label}</Text>
      <Text style={[styles.value, { fontSize: 27 * u }]}>{value}</Text>
    </View>
  );
  const disabled = busy || !mapReady;

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.back}>‹ BACK</Text>
      </Pressable>

      <View style={styles.chips}>
        {(['map', 'dark'] as const).map((l) => (
          <Pressable key={l} style={[styles.chip, look === l && styles.chipOn]} onPress={() => setLook(l)}>
            <Text style={[styles.chipText, look === l && styles.chipTextOn]}>{l === 'map' ? 'STREET MAP' : 'DARK ROUTE'}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ alignItems: 'center', marginTop: 12 }}>
        {/* the captured card is square-cornered (a story has no rounded corners); only this preview wrapper is rounded */}
        <View style={{ borderRadius: 18 * u, overflow: 'hidden' }}>
        <View ref={card} collapsable={false} style={[styles.card, { width: cw, height: ch, padding: 22 * u }]}>
          <View style={styles.head}>
            <Image source={require('../assets/logo-mark.png')} style={{ width: 62 * u, height: 41 * u }} resizeMode="contain" />
            <Text style={{ fontSize: 24 * u, marginLeft: 8 * u }}>
              <Text style={styles.brandRun}>RUN</Text>
              <Text style={styles.brandButan}>butan</Text>
            </Text>
          </View>

          <Text style={[styles.title, { fontSize: 26 * u, marginTop: 14 * u }]} numberOfLines={1}>{runTitle(run)}</Text>
          <Text style={[styles.date, { fontSize: 13 * u }]}>{fmtDate(run.startedAt)}</Text>

          <View style={{ height: 250 * u, marginTop: 12 * u, borderRadius: 16 * u, overflow: 'hidden' }}>
            <RouteMap
              key={look}
              points={track}
              height={250 * u}
              plain={look === 'dark'}
              onSettled={() => setMapReady(true)}
            />
          </View>

          <View style={[styles.distRow, { marginTop: 8 * u }]}>
            <Text style={[styles.dist, { fontSize: 80 * u, lineHeight: 88 * u }]}>{distNum(run.distanceM)}</Text>
            <Text style={[styles.unit, { fontSize: 22 * u }]}>{unitName().toUpperCase()}</Text>
          </View>

          <View style={{ flexDirection: 'row', marginTop: 4 * u }}>
            {stat(`PACE ${paceLabel().toUpperCase()}`, fmtPace(run.avgPaceSec))}
            {stat('TIME', fmtTime(run.elapsedSec ?? run.movingSec))}
            {run.elevGainM !== undefined && run.elevGainM >= 1 ? stat('ELEV ▲', `${Math.round(run.elevGainM)} m`) : null}
          </View>

          {badge ? (
            <View style={[styles.badge, { marginTop: 12 * u, paddingVertical: 8 * u, paddingHorizontal: 12 * u, borderRadius: 10 * u }]}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 * u }}>🏆 {badgeText(badge)}</Text>
            </View>
          ) : null}

          <View style={{ flex: 1 }} />
        </View>
        </View>
      </View>

      <Text style={styles.hint}>{mapReady ? 'Looks good? Share it or save it to your gallery.' : 'Loading the map…'}</Text>
      <View style={styles.row}>
        <Pressable style={[styles.btn, disabled && styles.btnOff]} onPress={share} disabled={disabled}>
          <Text style={styles.btnText}>SHARE</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btn2, disabled && styles.btnOff]} onPress={save} disabled={disabled}>
          <Text style={styles.btnText}>{Platform.OS === 'ios' ? 'SAVE TO PHOTOS' : 'SAVE TO GALLERY'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  back: { color: '#FF4D2E', fontWeight: '800', letterSpacing: 1.5, marginTop: 14 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 12 },
  chip: { flex: 1, backgroundColor: '#17171F', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  chipOn: { backgroundColor: '#FF4D2E' },
  chipText: { color: '#8A8A96', fontWeight: '800', fontSize: 12, letterSpacing: 1.2 },
  chipTextOn: { color: '#fff' },
  card: { backgroundColor: '#0B0B0F', overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center' },
  brandRun: { color: '#E02030', fontWeight: '900', fontStyle: 'italic' },
  brandButan: { color: '#8FC23A', fontWeight: '700' },
  title: { color: '#fff', fontWeight: '900' },
  date: { color: '#8A8A96', fontWeight: '700', marginTop: 2 },
  distRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 12 },
  dist: { color: '#fff', fontWeight: '900', fontVariant: ['tabular-nums'] },
  unit: { color: '#FF4D2E', fontWeight: '900', marginLeft: 8 },
  label: { color: '#8A8A96', fontWeight: '800', letterSpacing: 1.2 },
  value: { color: '#fff', fontWeight: '800', fontVariant: ['tabular-nums'] },
  badge: { backgroundColor: '#22222C', alignSelf: 'flex-start' },
  hint: { color: '#8A8A96', textAlign: 'center', fontSize: 13, marginTop: 10 },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { flex: 1, backgroundColor: '#FF4D2E', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  btn2: { backgroundColor: '#2A2A35' },
  btnOff: { opacity: 0.45 },
  btnText: { color: '#fff', fontWeight: '900', letterSpacing: 1.1, fontSize: 13 },
});
