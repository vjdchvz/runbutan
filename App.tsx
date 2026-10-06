import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Image, Pressable, Switch, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { startTracking, stopTracking } from './src/locationTask';
import {
  fmtPace,
  fmtTime,
  getElapsedSec,
  getGps,
  getCoach,
  getCoachResult,
  getGpsDiag,
  getSplitUnit,
  resetSession,
  skipCoachStep,
  getStartedAt,
  initVoice,
  pauseSession,
  sayCoach,
  resumeSession,
  speakTest,
  getStats,
  getTrack,
  reportGps,
  setVoiceEnabled,
  startSession,
  stopSession,
  subscribe,
  Stats,
  TrackPt,
} from './src/session';
import { MIN_SAVE_DISTANCE_M, Run } from './src/history';
import { loadSettings, useSettings } from './src/settings';
import { distNum, paceLabel, unitName } from './src/units';
import { badgeText } from './src/efforts';
import { migrateEfforts, migrateMovingTime } from './src/migrate';
import { clearSnapshot, loadSnapshot, persistRun, saveSnapshot } from './src/inprogress';
import { SEED_DEMO, seedDemo } from './src/seed';
import YouScreen from './src/YouScreen';
import CoachScreen, { PlanCtx } from './src/CoachScreen';
import SettingsScreen from './src/SettingsScreen';
import { cancelRunNotification, onRunAction, showRunNotification } from './modules/runkit';
import { markSessionDone } from './src/coach/store';
import { paceFmt, planById, planSessions, stepAmount, stepName, Workout } from './src/coach/workouts';
import type { ZonePaces } from './src/coach/vdot';
import HistoryScreen from './src/HistoryScreen';
import { useDialog } from './src/Dialog';
import RouteMap from './src/RouteMap';

type Tab = 'run' | 'history' | 'coach' | 'you' | 'settings';
type Armed = { w: Workout; ctx: PlanCtx | null; paces: ZonePaces | null };

// Memoised so the 1-second clock tick and GPS updates don't redraw the other tabs.
const HistoryTab = memo(HistoryScreen);
const YouTab = memo(YouScreen);
const CoachTab = memo(CoachScreen);

const snapshotNow = (): { run: Run; route: TrackPt[] } => {
  const f = getStats();
  const startedAt = getStartedAt();
  return {
    run: {
      id: String(startedAt),
      startedAt,
      distanceM: f.distanceM,
      movingSec: f.movingSec,
      elapsedSec: getElapsedSec(),
      elevGainM: f.elevGainM,
      avgPaceSec: f.avgPaceSec,
      splits: f.splits,
      splitUnit: getSplitUnit(),
    },
    route: getTrack(),
  };
};

export default function App() {
  useSettings(); // redraw everything when the unit (or any setting) changes
  useEffect(() => {
    loadSettings();
  }, []);
  const [s, setS] = useState<Stats>(getStats());
  const [tab, setTab] = useState<Tab>('run');
  const { dialog, showDialog } = useDialog();
  const [ready, setReady] = useState(!SEED_DEMO); // demo seeding (test builds only) must finish before screens load
  useEffect(() => {
    if (SEED_DEMO) seedDemo().then(() => setReady(true)).catch(() => setReady(true));
  }, []);
  const [voice, setVoice] = useState(true);
  useEffect(() => {
    initVoice();
  }, []);
  const [idleFix, setIdleFix] = useState<TrackPt | null>(null); // where you are before START
  useEffect(() => subscribe(setS), []);

  // Voice call-outs on/off, remembered between launches.
  useEffect(() => {
    AsyncStorage.getItem('runbutan.voice')
      .then((v) => {
        const on = v !== '0';
        setVoice(on);
        setVoiceEnabled(on);
      })
      .catch(() => {});
  }, []);
  const toggleVoice = (on: boolean) => {
    setVoice(on);
    setVoiceEnabled(on);
    AsyncStorage.setItem('runbutan.voice', on ? '1' : '0').catch(() => {});
  };

  // Re-render every second so the clock and GPS status keep moving even with no GPS fixes.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (tab !== 'run') return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [tab]);

  // On launch: stop a leftover tracking service (e.g. restarted by Android after a crash), and offer
  // back a run that was cut short. Skipped if a run is live (the screen was only recreated).
  useEffect(() => {
    if (getStats().running) return;
    stopTracking().catch(() => {});
    loadSnapshot().then((snap) => {
      if (!snap) return;
      if (snap.run.distanceM < MIN_SAVE_DISTANCE_M) {
        clearSnapshot().catch(() => {});
        return;
      }
      showDialog({
        title: 'Unfinished run found',
        highlight: `${distNum(snap.run.distanceM)} ${unitName()} · ${fmtTime(snap.run.elapsedSec ?? snap.run.movingSec)}`,
        message: 'RUNbutan was closed during this run. Save what was recorded?',
        confirmLabel: 'SAVE RUN',
        cancelLabel: 'DISCARD',
        onCancel: () => void clearSnapshot().catch(() => {}),
        onConfirm: () =>
          persistRun(snap.run, snap.route)
            .then(() => clearSnapshot())
            .catch(() => showDialog({ title: 'RUNbutan', message: "Couldn't save the run. It is kept and will be offered again next launch.", confirmLabel: 'OK' })),
      });
    });
  }, []);

  // While running, keep a recoverable copy: every 15 s, and the moment the app goes to the background.
  useEffect(() => {
    if (!s.running) return;
    const write = () => {
      if (getStats().running) saveSnapshot(snapshotNow()).catch(() => {});
    };
    const id = setInterval(write, 15000);
    const sub = AppState.addEventListener('change', (st) => st !== 'active' && write());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [s.running, s.paused]);

  // Warm GPS up before START so the lock is ready (and the status chip works) at the start line.
  useEffect(() => {
    if (s.running) return;
    let dead = false;
    let sub: Location.LocationSubscription | undefined;
    (async () => {
      const p = await Location.requestForegroundPermissionsAsync();
      if (p.status !== 'granted' || dead) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
        (l) => {
          reportGps(l.coords.accuracy);
          setIdleFix({ t: l.timestamp, lat: l.coords.latitude, lon: l.coords.longitude });
        },
      );
      if (dead) sub.remove();
    })().catch(() => {});
    return () => {
      dead = true;
      sub?.remove();
    };
  }, [s.running]);

  const confirmStop = () =>
    showDialog({
      title: 'Stop run?',
      highlight: `${distNum(s.distanceM)} ${unitName()} · ${fmtTime(getElapsedSec())}`,
      message: 'This will finish and save your run.',
      confirmLabel: 'STOP & SAVE',
      cancelLabel: 'KEEP RUNNING',
      onConfirm: () => void toggle(),
    });

  // Recalculate older runs' best efforts in the background, a few seconds after launch.
  useEffect(() => {
    const id = setTimeout(() => migrateEfforts().catch(() => {}), 4000);
    return () => clearTimeout(id);
  }, []);

  // One-time: bring older runs' moving time/pace/splits in line with Strava (see movingStats.ts).
  useEffect(() => {
    const id = setTimeout(() => migrateMovingTime().catch(() => {}), 4000);
    return () => clearTimeout(id);
  }, []);

  // A workout picked in the COACH tab waits here until START RUN.
  const [armed, setArmed] = useState<Armed | null>(null);
  const armedRef = useRef<Armed | null>(null);
  armedRef.current = armed;
  const onStartWorkout = useCallback(
    (w: Workout, ctx: PlanCtx | null, paces: ZonePaces | null) => {
      setArmed({ w, ctx, paces });
      setTab('run');
      if (!voice) {
        showDialog({
          title: 'Voice is muted',
          message: 'The coach talks you through each part of the workout. Turn the voice on to hear it.',
          confirmLabel: 'TURN ON VOICE',
          cancelLabel: 'KEEP MUTED',
          onConfirm: () => toggleVoice(true),
        });
      }
    },
    [voice, showDialog],
  );

  // Android Back on the Settings page returns to the run screen.
  useEffect(() => {
    if (tab !== 'settings') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setTab('run');
      return true;
    });
    return () => sub.remove();
  }, [tab]);

  // ---- lock-screen notification: live stats plus Pause / Stop. Stop must be pressed twice. ----
  const stopArmedUntil = useRef(0);
  const toggleRef = useRef<() => void>(() => {});
  useEffect(() => {
    const push = () => {
      const st = getStats();
      if (!st.running) return;
      const c = getCoach();
      const live = !!c && !c.finished;
      const title = `RUNbutan · ${fmtTime(getElapsedSec())}${st.paused ? ' · PAUSED' : ''}`;
      const text = live && c
        ? `Part ${c.index + 1}/${c.total} · ${stepName(c.step)} ${c.remainingSec !== null ? fmtTime(c.remainingSec) : `${c.remainingM} m`}`
        : `${distNum(st.distanceM)} ${unitName()} · ${fmtPace(st.currentPaceSec)} ${paceLabel()}`;
      showRunNotification(title, text, st.paused, Date.now() < stopArmedUntil.current);
    };
    let last = 0;
    const unsub = subscribe(() => {
      const now = Date.now();
      if (now - last < 1800) return;
      last = now;
      push();
    });
    const off = onRunAction((a) => {
      const st = getStats();
      if (!st.running) return;
      if (a === 'toggle') {
        if (st.paused) resumeSession();
        else pauseSession();
        push();
        return;
      }
      if (Date.now() < stopArmedUntil.current) {
        stopArmedUntil.current = 0;
        toggleRef.current();
        return;
      }
      stopArmedUntil.current = Date.now() + 6000;
      sayCoach('Tap stop again to finish.', true);
      push();
      setTimeout(push, 6200);
    });
    return () => {
      unsub();
      off();
    };
  }, []);

  const busy = useRef(false); // a second tap while START/STOP is still working must do nothing

  const finishRun = async () => {
    const snap = snapshotNow();
    if (snap.run.distanceM < MIN_SAVE_DISTANCE_M) {
      // Too short to keep automatically. Say why (instead of silently dropping it) and let the user decide.
      await clearSnapshot().catch(() => {});
      const { fixesSeen, bestAccuracy } = getGpsDiag();
      const why =
        fixesSeen === 0
          ? 'GPS never connected, so nothing was recorded. Before you start, wait for the green GPS bars (open sky helps, especially with no data).'
          : snap.run.distanceM < 1
            ? bestAccuracy !== null && bestAccuracy <= 35
              ? 'GPS was working but no movement was recorded.'
              : `The GPS signal was too weak to track movement (best ±${Math.round(bestAccuracy ?? 0)} m). Wait for the green GPS bars before you start.`
            : 'This run is shorter than 50 m.';
      const res = getCoachResult();
      const ctx = armedRef.current?.ctx ?? null;
      const counted = res.finished && !!ctx;
      if (counted && ctx) markSessionDone(ctx.planId, ctx.sessionId).catch(() => {});
      showDialog({
        title: 'Run not saved',
        highlight: `${distNum(snap.run.distanceM)} ${unitName()}`,
        message: counted ? `${why}\n\nYour training session was still counted as done.` : why,
        confirmLabel: snap.run.distanceM >= 1 ? 'SAVE ANYWAY' : 'OK',
        cancelLabel: snap.run.distanceM >= 1 ? 'DISCARD' : undefined,
        onConfirm:
          snap.run.distanceM >= 1
            ? () => void persistRun(snap.run, snap.route, true).catch(() => {})
            : undefined,
      });
      return;
    }
    try {
      await saveSnapshot(snap).catch(() => {}); // safety copy before anything that could fail
      const saved = await persistRun(snap.run, snap.route);
      await clearSnapshot();
      const badges = saved.badges ?? [];
      const lines = [...badges].sort((a, b) => a.rank - b.rank || b.d - a.d).map(badgeText);
      const result = getCoachResult();
      const ctx = armedRef.current?.ctx ?? null;
      if (result.finished && ctx) {
        const prog = await markSessionDone(ctx.planId, ctx.sessionId);
        const plan = planById(ctx.planId);
        lines.unshift(`${plan?.name ?? 'Plan'}: ${prog.done.length} of ${plan ? planSessions(plan).length : '?'} sessions done.`);
      }
      if (lines.length) {
        showDialog({
          title: result.finished && ctx ? '🎉 Session complete!' : '🏆 New best effort!',
          highlight: `${distNum(snap.run.distanceM)} ${unitName()}`,
          message: lines.join('\n'),
          confirmLabel: 'NICE',
        });
      }
    } catch {
      showDialog({
        title: "Couldn't save the run",
        message: 'Your run is kept safely and will be offered again the next time you open RUNbutan.',
        confirmLabel: 'OK',
      });
    }
  };

  const toggle = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (s.running) {
        try {
          await stopTracking();
        } catch {
          // even if the GPS service won't stop cleanly, still finish and save the run
        }
        stopSession();
        deactivateKeepAwake();
        await finishRun();
        resetSession(); // the saved run now lives in History; clear it from this screen
        setArmed(null);
        cancelRunNotification();
        setTimeout(cancelRunNotification, 1500); // in case a last update slipped in
      } else {
        await startTracking();
        startSession(armedRef.current?.w, armedRef.current?.paces);
        activateKeepAwakeAsync();
      }
    } catch (e) {
      showDialog({ title: 'RUNbutan', message: e instanceof Error ? e.message : 'Could not start tracking', confirmLabel: 'OK' });
    } finally {
      busy.current = false;
    }
  };

  toggleRef.current = () => void toggle();
  const coach = s.running ? getCoach() : null;
  const coachLive = !!coach && !coach.finished;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {dialog}
      <View style={styles.header}>
        <View style={styles.logoBadge}>
          <Image source={require('./assets/logo-mark.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <Text style={styles.brand}>
          <Text style={styles.brandRun}>RUN</Text>
          <Text style={styles.brandButan}>butan</Text>
        </Text>
        <GpsChip />
        <Pressable onPress={() => setTab('settings')} hitSlop={10} style={styles.gear}><Text style={styles.gearText}>⚙</Text></Pressable>
      </View>

      <View style={styles.tabs}>
        <TabButton label="RUN" active={tab === 'run'} onPress={() => setTab('run')} />
        <TabButton label="HISTORY" active={tab === 'history'} onPress={() => setTab('history')} />
        <TabButton label="COACH" active={tab === 'coach'} onPress={() => setTab('coach')} />
        <TabButton label="YOU" active={tab === 'you'} onPress={() => setTab('you')} />
      </View>

      {!ready ? null : tab === 'history' ? (
        <HistoryTab />
      ) : tab === 'settings' ? (
        <SettingsScreen onBack={() => setTab('run')} muted={!voice} />
      ) : tab === 'coach' ? (
        <CoachTab running={s.running} onStartWorkout={onStartWorkout} />
      ) : tab === 'you' ? (
        <YouTab />
      ) : (
        <>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
          <View style={styles.voiceRow}>
            <Text style={styles.voiceLabel}>{voice ? '🔊 VOICE CALL-OUTS' : '🔇 VOICE MUTED'}</Text>
            {voice && (
              <Pressable onPress={speakTest} hitSlop={10} style={styles.testBtn}>
                <Text style={styles.testText}>▶ TEST</Text>
              </Pressable>
            )}
            <Switch
              value={voice}
              onValueChange={toggleVoice}
              trackColor={{ false: '#3A3A46', true: '#FF4D2E' }}
              thumbColor="#fff"
            />
          </View>

          {armed && !s.running && (
            <View style={styles.banner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerLabel}>🎯 WORKOUT READY · PRESS START</Text>
                <Text style={styles.bannerName}>{armed.w.name}</Text>
              </View>
              <Pressable onPress={() => setArmed(null)} hitSlop={12}><Text style={styles.bannerX}>✕</Text></Pressable>
            </View>
          )}
          {coach && (
            <View style={styles.coachCard}>
              {coach.finished ? (
                <Text style={styles.coachDone}>✅ WORKOUT COMPLETE · keep going or press STOP</Text>
              ) : (
                <>
                  <View style={styles.coachTop}>
                    <Text style={styles.coachStep}>PART {coach.index + 1}/{coach.total} · {stepName(coach.step).toUpperCase()}</Text>
                    <Pressable onPress={skipCoachStep} hitSlop={10}><Text style={styles.coachSkip}>SKIP ›</Text></Pressable>
                  </View>
                  <Text style={styles.coachTime}>{coach.remainingSec !== null ? fmtTime(coach.remainingSec) : `${coach.remainingM} m`}</Text>
                  <View style={styles.coachTrack}><View style={[styles.coachFill, { width: `${coach.frac * 100}%` }]} /></View>
                  <Text style={styles.coachNext}>
                    {coach.range ? `Target ${paceFmt(coach.range[0])}–${paceFmt(coach.range[1])} ${paceLabel()} · ` : ''}
                    {coach.next ? `Next: ${stepName(coach.next)} ${stepAmount(coach.next)}` : 'Last part'}
                  </Text>
                </>
              )}
            </View>
          )}

          <Text style={[styles.label, s.paused && styles.paused]}>{s.paused ? '⏸ PAUSED' : `PACE ${paceLabel().toUpperCase()}`}</Text>
          <Text style={[styles.hero, coachLive && { fontSize: 56 }]}>{fmtPace(s.currentPaceSec)}</Text>

          <View style={styles.row}>
            <Stat label={`AVG ${paceLabel().toUpperCase()}`} value={fmtPace(s.avgPaceSec)} />
            <Stat label={unitName().toUpperCase()} value={distNum(s.distanceM)} />
            <Stat label="TIME" value={fmtTime(getElapsedSec())} />
          </View>
          {!coachLive && (
          <View style={styles.row}>
            <Stat label="ELEV ▲" value={`${Math.round(s.elevGainM)} m`} />
            <Stat label="ELEV ▼" value={`${Math.round(s.elevLossM)} m`} />
            <Stat label="ALTITUDE" value={s.altitudeM === null ? '-- m' : `${Math.round(s.altitudeM)} m`} />
          </View>
          )}

          <View style={styles.map}>
            <RouteMap
              follow
              points={s.running ? getTrack() : idleFix ? [idleFix] : []}
              height={190}
              emptyText={s.running ? 'Waiting for GPS…' : 'Finding your location…'}
            />
          </View>

          <View style={[styles.splits, { gap: 8 }]}>
            {[...s.splits].reverse().map((sp) => (
              <View key={sp.km} style={styles.splitRow}>
                <Text style={styles.splitKm}>{getSplitUnit().toUpperCase()} {sp.km}</Text>
                <Text style={styles.splitTime}>{fmtPace(sp.splitSec / (getSplitUnit() === 'mi' ? 1.609344 : 1))} {paceLabel()}</Text>
                <Text style={styles.splitTotal}>{fmtTime(sp.totalSec)}</Text>
              </View>
            ))}
          </View>

          </ScrollView>

          <View style={styles.controls}>
            {s.running && (
              <Pressable
                style={[styles.btn, styles.ctrl, s.paused ? styles.btnResume : styles.btnPause]}
                onPress={() => (s.paused ? resumeSession() : pauseSession())}
              >
                <Text style={styles.btnText}>{s.paused ? 'RESUME' : 'PAUSE'}</Text>
              </Pressable>
            )}
            <Pressable style={[styles.btn, styles.ctrl, s.running && styles.btnStop]} onPress={s.running ? confirmStop : toggle}>
              <Text style={styles.btnText}>{s.running ? 'STOP' : 'START RUN'}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// 4-bar GPS signal indicator: more bars = tighter accuracy. Grey = no fix yet / signal lost.
const GpsChip = () => {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const { accuracy, ageMs } = getGps();
  const never = ageMs === Infinity;
  const lost = !never && (ageMs > 8000 || accuracy === null);
  const bars = never || lost ? 0 : accuracy! <= 8 ? 4 : accuracy! <= 15 ? 3 : accuracy! <= 25 ? 2 : 1;
  const color = bars >= 3 ? '#3CB043' : bars === 2 ? '#E0B020' : bars === 1 ? '#E02030' : '#55555F';
  const label = never ? 'Searching…' : lost ? 'Signal lost' : `±${Math.round(accuracy!)} m`;
  return (
    <View style={styles.chip}>
      <View style={styles.bars}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.bar, { height: 4 + i * 4, backgroundColor: i <= bars ? color : '#3A3A46' }]} />
        ))}
      </View>
      <View>
        <Text style={styles.chipTitle}>GPS</Text>
        <Text style={[styles.chipText, { color }]}>{label}</Text>
      </View>
    </View>
  );
};

const TabButton = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
  <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
    <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
  </Pressable>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.stat}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0F', paddingTop: 64, paddingHorizontal: 20, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoBadge: { paddingHorizontal: 6, paddingVertical: 4 },
  logo: { width: 56, height: 38 },
  brand: { fontSize: 24, letterSpacing: 1 },
  brandRun: { color: '#E02030', fontWeight: '900', fontStyle: 'italic' },
  brandButan: { color: '#8FC23A', fontWeight: '700' },
  chip: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#17171F', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 20 },
  bar: { width: 5, borderRadius: 2 },
  chipTitle: { color: '#8A8A96', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  chipText: { fontSize: 12, fontWeight: '800' },
  voiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  voiceLabel: { color: '#8A8A96', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  banner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1F2A1F', borderRadius: 14, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#2E4A2E' },
  bannerLabel: { color: '#7FD67F', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  bannerName: { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 2 },
  bannerX: { color: '#8A8A96', fontSize: 20, paddingHorizontal: 6 },
  coachCard: { backgroundColor: '#17171F', borderRadius: 16, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#FF4D2E' },
  coachTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  coachStep: { color: '#FF4D2E', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  coachSkip: { color: '#8A8A96', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  coachTime: { color: '#fff', fontSize: 44, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 2 },
  coachTrack: { height: 6, borderRadius: 3, backgroundColor: '#26262F', overflow: 'hidden', marginTop: 4 },
  coachFill: { height: 6, backgroundColor: '#FF4D2E' },
  coachNext: { color: '#8A8A96', fontSize: 13, fontWeight: '600', marginTop: 8 },
  coachDone: { color: '#7FD67F', fontSize: 14, fontWeight: '900' },
  gear: { marginLeft: 10, width: 38, height: 38, borderRadius: 12, backgroundColor: '#17171F', alignItems: 'center', justifyContent: 'center' },
  gearText: { color: '#C8C8D0', fontSize: 20 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#17171F' },
  tabActive: { backgroundColor: '#FF4D2E' },
  tabText: { color: '#8A8A96', fontWeight: '800', letterSpacing: 1.5, fontSize: 13 },
  tabTextActive: { color: '#fff' },
  label: { color: '#8A8A96', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginTop: 24 },
  hero: { color: '#fff', fontSize: 96, fontWeight: '900', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1 },
  statValue: { color: '#fff', fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  map: { marginTop: 20 },
  splits: { marginTop: 16 },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#17171F', padding: 14, borderRadius: 12 },
  splitKm: { color: '#8A8A96', fontWeight: '700', width: 70 },
  splitTime: { color: '#fff', fontWeight: '800', fontSize: 18 },
  splitTotal: { color: '#8A8A96', fontVariant: ['tabular-nums'] },
  btn: { backgroundColor: '#FF4D2E', paddingVertical: 20, borderRadius: 16, alignItems: 'center' },
  controls: { flexDirection: 'row', gap: 12 },
  ctrl: { flex: 1 },
  btnPause: { backgroundColor: '#2A2A35' },
  btnResume: { backgroundColor: '#2E9E3A' },
  paused: { color: '#E0B020' },
  testBtn: { marginRight: 'auto', marginLeft: 12, backgroundColor: '#17171F', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  testText: { color: '#C8C8D0', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  btnStop: { backgroundColor: '#3A3A46' },
  btnText: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 1.5 },
});
