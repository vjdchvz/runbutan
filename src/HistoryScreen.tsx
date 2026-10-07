import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { deleteRun, loadRuns, loadTrack, Run, summarize, thumbToTrack, updateRun } from './history';
import { badgeText, effortLabel, isEffortDistance } from './efforts';
import { saveGpxToDownloads, shareGpx, STRAVA_UPLOAD_URL } from './gpx';
import RouteMap from './RouteMap';
import { DialogOptions, useDialog } from './Dialog';
import StoryScreen from './StoryScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthState, useGoogleSignIn } from './auth';
import { onRunsPulled, syncChangedRun, syncDeletedRun } from './sync';
import { fmtPace, fmtTime, TrackPt } from './session';
import { runTitle } from './stats';
import { getSettings, useSettings } from './settings';
import { caloriesFor, fmtKcal } from './calories';
import { distNum, paceLabel, unitName } from './units';

const fmtDate = (t: number) => {
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
};
// Old runs (saved before thumbnails existed) build theirs lazily. Doing them all at once means loading every
// full route in one burst and freezes the UI, so they go through a queue: one at a time, with a short pause.
let thumbChain: Promise<void> = Promise.resolve();
const queueThumb = (job: () => Promise<void>) => {
  thumbChain = thumbChain
    .then(job)
    .catch(() => {})
    .then(() => new Promise<void>((r) => setTimeout(r, 120)));
};

const MEDAL = { 1: '🏆', 2: '🥈', 3: '🥉' } as const;

export default function HistoryScreen() {
  useSettings(); // redraw when the unit changes
  const [runs, setRuns] = useState<Run[]>([]);
  const { dialog, showDialog } = useDialog();
  const [selected, setSelected] = useState<Run | null>(null);
  const refresh = useCallback(() => loadRuns().then(setRuns), []);
  useEffect(() => {
    refresh();
    return onRunsPulled(refresh); // runs restored from the cloud appear right away
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null); // Back from a run returns to the list instead of closing the app
      return true;
    });
    return () => sub.remove();
  }, [selected]);

  const sum = summarize(runs);

  const confirmDelete = (r: Run) =>
    showDialog({
      title: 'Delete run?',
      highlight: `${distNum(r.distanceM)} ${unitName()}`,
      message: `${fmtDate(r.startedAt)}\nThis can't be undone.`,
      confirmLabel: 'DELETE',
      cancelLabel: 'CANCEL',
      danger: true,
      onConfirm: () =>
        deleteRun(r.id)
          .then(() => {
            syncDeletedRun(r.id).catch(() => {});
            setSelected(null);
            refresh();
          })
          .catch(() => showDialog({ title: 'RUNbutan', message: "Couldn't delete the run.", confirmLabel: 'OK' })),
    });

  if (selected) {
    return (
      <>
        <RunDetail
          run={selected}
          onBack={() => setSelected(null)}
          onDelete={() => confirmDelete(selected)}
          onRenamed={(title) => {
            setSelected((s) => (s ? { ...s, title } : s));
            refresh();
          }}
          onError={(message) => showDialog({ title: 'RUNbutan', message, confirmLabel: 'OK' })}
          onDialog={showDialog}
        />
        {dialog}
      </>
    );
  }

  return (
    <View style={styles.root}>
      {dialog}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
        <View>
          <Text style={styles.label}>ALL RUNS · AVG PACE {paceLabel().toUpperCase()}</Text>
          <Text style={styles.hero}>{fmtPace(sum.avgPaceSec)}</Text>
          <View style={styles.row}>
            <Stat label="RUNS" value={String(sum.runs)} />
            <Stat label={`TOTAL ${unitName().toUpperCase()}`} value={distNum(sum.distanceM)} />
            <Stat label="TIME" value={fmtTime(sum.elapsedSec)} />
          </View>
          <View style={styles.row}>
            <Stat label={`AVG ${unitName().toUpperCase()}/RUN`} value={distNum(sum.avgDistanceM)} />
            <Stat label="BEST AVG" value={fmtPace(sum.bestAvgPaceSec)} />
            <Stat label="TOTAL ELEV ▲" value={`${Math.round(sum.elevGainM)} m`} />
          </View>
        </View>

        <BackupCard runCount={runs.length} />

        <Text style={[styles.label, { marginTop: 4 }]}>ACTIVITIES</Text>
        {runs.length === 0 && <Text style={styles.empty}>No runs yet. Go run!</Text>}
        {runs.map((r) => (
          <RunCard key={r.id} run={r} onPress={() => setSelected(r)} onLongPress={() => confirmDelete(r)} />
        ))}
        {runs.length > 0 && <Text style={styles.hint}>Tap a run for details · long-press to delete</Text>}
      </ScrollView>
    </View>
  );
}

// Shown while signed out with runs on the phone: they are not backed up anywhere yet.
// "Later" hides it for a week; it never shows once signed in.
const BACKUP_SNOOZE = 'runbutan.backupCard.snoozedUntil';
function BackupCard({ runCount }: { runCount: number }) {
  const { user, loading } = useAuthState();
  const { signIn, ready, pending, error } = useGoogleSignIn();
  const [snoozed, setSnoozed] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem(BACKUP_SNOOZE)
      .then((v) => setSnoozed(!!v && Number(v) > Date.now()))
      .catch(() => setSnoozed(false));
  }, []);
  if (loading || user || !ready || snoozed || runCount === 0) return null;
  const later = () => {
    setSnoozed(true);
    AsyncStorage.setItem(BACKUP_SNOOZE, String(Date.now() + 7 * 24 * 3600 * 1000)).catch(() => {});
  };
  return (
    <View style={styles.backup}>
      <Text style={styles.backupTitle}>Your runs are only on this phone</Text>
      <Text style={styles.backupText}>
        Sign in to back up {runCount === 1 ? 'your run' : `all ${runCount} runs`} to your Google account. Lose or change your phone and they come
        right back.
      </Text>
      {!!error && <Text style={styles.backupError}>{error}</Text>}
      <View style={styles.backupRow}>
        <Pressable style={[styles.backupBtn, pending && { opacity: 0.6 }]} onPress={signIn} disabled={pending}>
          <Text style={styles.backupBtnText} numberOfLines={1} maxFontSizeMultiplier={1.15}>
            {pending ? 'SIGNING IN…' : 'BACK UP WITH GOOGLE'}
          </Text>
        </Pressable>
        <Pressable onPress={later} hitSlop={8} style={styles.backupLater}>
          <Text style={styles.backupLaterText}>Later</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RunCard({ run, onPress, onLongPress }: { run: Run; onPress: () => void; onLongPress: () => void }) {
  // New runs carry a tiny thumbnail, so the list never has to load every full route. Older runs
  // build one the first time they are shown and keep it.
  const [track, setTrack] = useState<TrackPt[]>(run.thumb ? thumbToTrack(run.thumb) : []);
  useEffect(() => {
    if (run.thumb) return;
    let alive = true;
    queueThumb(async () => {
      if (!alive) return; // scrolled away / left the screen before its turn
      const t = await loadTrack(run.id);
      if (t.length < 2) return;
      const step = Math.max(1, Math.ceil(t.length / 60));
      const thumb = t.filter((_, i) => i % step === 0).map((p) => [p.lat, p.lon] as [number, number]);
      if (alive) setTrack(thumbToTrack(thumb));
      await updateRun(run.id, { thumb });
    });
    return () => {
      alive = false;
    };
  }, [run.id, run.thumb]);
  const badges = (run.badges ?? []).filter((b) => isEffortDistance(b.d)).sort((a, b) => a.rank - b.rank || b.d - a.d).slice(0, 2);

  return (
    <Pressable style={styles.card} onPress={onPress} onLongPress={onLongPress}>
      <Text style={styles.cardTitle}>{runTitle(run)}</Text>
      <Text style={styles.date}>{fmtDate(run.startedAt)}</Text>
      <View style={styles.cardRow}>
        <View>
          <Text style={styles.cardLabel}>DISTANCE</Text>
          <Text style={styles.cardKm}>{distNum(run.distanceM)} {unitName()}</Text>
        </View>
        <View>
          <Text style={styles.cardLabel}>PACE</Text>
          <Text style={styles.cardPace}>{fmtPace(run.avgPaceSec)} {paceLabel()}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.cardLabel}>TIME</Text>
          <Text style={styles.cardTime}>{fmtTime(run.elapsedSec ?? run.movingSec)}</Text>
        </View>
      </View>
      {badges.map((b) => (
        <View key={b.d} style={styles.badge}>
          <Text style={styles.badgeText}>{MEDAL[b.rank]} {badgeText(b)}</Text>
        </View>
      ))}
      {track.length > 1 && (
        <View style={{ marginTop: 10 }}>
          <RouteMap points={track} height={110} plain />
        </View>
      )}
    </Pressable>
  );
}

function RunDetail({
  run,
  onBack,
  onDelete,
  onRenamed,
  onError,
  onDialog,
}: {
  run: Run;
  onBack: () => void;
  onDelete: () => void;
  onRenamed: (title: string) => void;
  onError: (message: string) => void;
  onDialog: (o: DialogOptions) => void;
}) {
  const [track, setTrack] = useState<TrackPt[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [story, setStory] = useState(false);
  const [title, setTitle] = useState(runTitle(run));
  const weightKg = getSettings().weightKg;
  useEffect(() => {
    loadTrack(run.id).then(setTrack);
  }, [run.id]);

  const saveTitle = () => {
    setEditing(false);
    const t = title.trim();
    if (t === runTitle(run)) return;
    updateRun(run.id, { title: t || undefined })
      .then(() => {
        syncChangedRun(run.id);
        onRenamed(t);
      })
      .catch(() => onError("Couldn't rename the run."));
    if (!t) setTitle(runTitle({ ...run, title: undefined }));
  };

  const share = async () => {
    try {
      await shareGpx(run, track ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not share the run');
    }
  };
  const canShare = !!track && track.length > 1;

  // Strava's website can't be handed a file by an app, so: save the GPX to Downloads, then open the upload
  // page, where "Choose Files" finds it. If saving is impossible, fall back to the normal share sheet.
  const uploadToStrava = async () => {
    // iOS has no public Downloads folder: save through the share sheet's "Save to Files", then the
    // Strava page's "Choose Files" picks it up from Files.
    if (Platform.OS === 'ios') {
      onDialog({
        title: 'Ready for Strava',
        message: 'Tap SAVE FILE and choose "Save to Files". Then, on the Strava page, tap "Choose Files" and pick it. Log in first if Strava asks.',
        confirmLabel: 'SAVE FILE',
        cancelLabel: 'NOT NOW',
        onConfirm: async () => {
          await share();
          Linking.openURL(STRAVA_UPLOAD_URL).catch(() => onError('Could not open the browser. Open strava.com/upload/select yourself.'));
        },
      });
      return;
    }
    try {
      const name = await saveGpxToDownloads(run, track ?? []);
      onDialog({
        title: 'Ready for Strava',
        message: `Saved "${name}" in your Downloads folder.\n\nOn the Strava page, tap "Choose Files" and pick that file. Log in first if Strava asks.`,
        confirmLabel: 'OPEN STRAVA',
        cancelLabel: 'NOT NOW',
        onConfirm: () => {
          Linking.openURL(STRAVA_UPLOAD_URL).catch(() => onError('Could not open the browser. Open strava.com/upload/select yourself; the file is in Downloads.'));
        },
      });
    } catch (e) {
      onDialog({
        title: "Couldn't save the file",
        message: `${e instanceof Error ? e.message : 'Saving failed.'}\n\nYou can share the file instead and upload it from there.`,
        confirmLabel: 'SHARE FILE',
        cancelLabel: 'CANCEL',
        onConfirm: () => void share(),
      });
    }
  };
  const badges = (run.badges ?? []).filter((b) => isEffortDistance(b.d)).sort((a, b) => a.rank - b.rank || b.d - a.d);

  if (story && track && track.length > 1) {
    return <StoryScreen run={run} track={track} onBack={() => setStory(false)} onDialog={onDialog} />;
  }

  return (
    <View style={styles.root}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ ALL RUNS</Text>
        </Pressable>
        {editing ? (
          <TextInput
            value={title}
            onChangeText={setTitle}
            onSubmitEditing={saveTitle}
            onBlur={saveTitle}
            autoFocus
            selectTextOnFocus
            maxLength={40}
            returnKeyType="done"
            style={styles.titleInput}
            placeholderTextColor="#55555F"
          />
        ) : (
          <Pressable onPress={() => setEditing(true)} style={styles.titleRow} hitSlop={8}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.edit}>✎</Text>
          </Pressable>
        )}
        <Text style={styles.date2}>{fmtDate(run.startedAt)}</Text>

        <View style={styles.row}>
          <Stat label={unitName().toUpperCase()} value={distNum(run.distanceM)} />
          <Stat label={`AVG ${paceLabel().toUpperCase()}`} value={fmtPace(run.avgPaceSec)} />
          <Stat label="TIME" value={fmtTime(run.elapsedSec ?? run.movingSec)} />
        </View>
        <View style={styles.row}>
          {run.elevGainM !== undefined && <Stat label="ELEV GAIN" value={`${Math.round(run.elevGainM)} m`} />}
          <Stat label="KCAL" value={fmtKcal(caloriesFor(weightKg, run.distanceM, run.movingSec, run.elevGainM ?? 0))} />
        </View>

        <View style={{ marginTop: 14 }}>
          <RouteMap points={track ?? []} height={220} emptyText={track === null ? 'Loading…' : 'No route saved for this run'} />
        </View>

        <View style={[styles.list, { gap: 8 }]}>
          {badges.map((b) => (
            <View key={b.d} style={styles.badge}>
              <Text style={styles.badgeText}>{MEDAL[b.rank]} {badgeText(b)}</Text>
            </View>
          ))}
          {!!run.efforts?.some((e) => isEffortDistance(e.d)) && <Text style={[styles.label, { marginTop: 6 }]}>BEST EFFORTS IN THIS RUN</Text>}
          {run.efforts?.filter((e) => isEffortDistance(e.d)).map((e) => (
            <View key={e.d} style={styles.splitRow}>
              <Text style={styles.splitKm}>{effortLabel(e.d)}</Text>
              <Text style={styles.splitTime}>{fmtTime(e.s)}</Text>
              <Text style={styles.cardTime}>{fmtPace(e.s / (e.d / 1000))} {paceLabel()}</Text>
            </View>
          ))}
          {run.splits.length > 0 && <Text style={[styles.label, { marginTop: 6 }]}>{(run.splitUnit ?? 'km').toUpperCase()} SPLITS</Text>}
          {run.splits.map((sp) => (
            <View key={sp.km} style={styles.splitRow}>
              <Text style={styles.splitKm}>{(run.splitUnit ?? 'km').toUpperCase()} {sp.km}</Text>
              <Text style={styles.splitTime}>{fmtPace(sp.splitSec / (run.splitUnit === 'mi' ? 1.609344 : 1))} {paceLabel()}</Text>
              <Text style={styles.cardTime}>{fmtTime(sp.totalSec)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.btnRow}>
          <Pressable style={[styles.btn, { flex: 1.3 }, !canShare && styles.btnOff]} onPress={uploadToStrava} disabled={!canShare}>
            <Text style={styles.btnText} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>UPLOAD TO STRAVA</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnAlt, !canShare && styles.btnOff]} onPress={() => setStory(true)} disabled={!canShare}>
            <Text style={styles.btnText} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>STORY</Text>
          </Pressable>
        </View>
        <View style={styles.linkRow}>
          <Pressable onPress={share} disabled={!canShare} style={styles.link} hitSlop={6}>
            <Text style={[styles.linkText, !canShare && { opacity: 0.4 }]} numberOfLines={1}>Share GPX file</Text>
          </Pressable>
          <View style={styles.linkDot} />
          <Pressable onPress={onDelete} style={styles.link} hitSlop={6}>
            <Text style={[styles.linkText, styles.linkDanger]} numberOfLines={1}>Delete run</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.stat}>
    <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={1.2}>{label}</Text>
    <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  label: { color: '#8A8A96', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginTop: 14 },
  hero: { color: '#fff', fontSize: 64, fontWeight: '900', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1 },
  statValue: { color: '#fff', fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  list: { marginTop: 12 },
  empty: { color: '#8A8A96', textAlign: 'center', marginTop: 24 },
  hint: { color: '#55555F', textAlign: 'center', fontSize: 12, marginTop: 2 },
  card: { backgroundColor: '#17171F', padding: 14, borderRadius: 16 },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  date: { color: '#8A8A96', fontSize: 12, fontWeight: '700', marginTop: 2 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  cardLabel: { color: '#55555F', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  cardKm: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 2 },
  cardPace: { color: '#FF4D2E', fontSize: 18, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  cardTime: { color: '#8A8A96', fontSize: 16, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  badge: { backgroundColor: '#22222C', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginTop: 10 },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  back: { color: '#FF4D2E', fontWeight: '800', letterSpacing: 1.5, marginTop: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  title: { color: '#fff', fontSize: 26, fontWeight: '900' },
  edit: { color: '#8A8A96', fontSize: 18 },
  titleInput: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 8, paddingVertical: 0, borderBottomWidth: 2, borderBottomColor: '#FF4D2E' },
  date2: { color: '#8A8A96', fontWeight: '700', marginTop: 2 },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#17171F', padding: 12, borderRadius: 12 },
  splitKm: { color: '#8A8A96', fontWeight: '700', width: 110 },
  splitTime: { color: '#fff', fontWeight: '800', fontSize: 16 },
  backup: { backgroundColor: '#17171F', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2E2E3A', borderLeftWidth: 3, borderLeftColor: '#FF4D2E' },
  backupTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  backupText: { color: '#A0A0AC', fontSize: 13, lineHeight: 19, marginTop: 4 },
  backupError: { color: '#E0604F', fontSize: 12, marginTop: 6 },
  backupRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 },
  backupBtn: { flex: 1, backgroundColor: '#FF4D2E', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  backupBtnText: { color: '#fff', fontWeight: '900', fontSize: 13, letterSpacing: 1 },
  backupLater: { paddingHorizontal: 6, paddingVertical: 8 },
  backupLaterText: { color: '#8A8A96', fontWeight: '700' },
  footer: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#22222B' },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, backgroundColor: '#FF4D2E', paddingVertical: 15, paddingHorizontal: 10, borderRadius: 14, alignItems: 'center' },
  btnOff: { backgroundColor: '#3A3A46' },
  btnAlt: { backgroundColor: '#22222B', borderWidth: 1, borderColor: '#33333F' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 1.2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 10 },
  link: { paddingVertical: 4 },
  linkText: { color: '#8A8A96', fontWeight: '700', fontSize: 13 },
  linkDanger: { color: '#C2483A' },
  linkDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#44444F' },
  delete: { alignItems: 'center', paddingVertical: 12 },
  deleteText: { color: '#8A8A96', fontWeight: '700' },
});
