import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { loadRuns, loadTrack, saveRun, type Run } from './history';
import type { TrackPt } from './session';

// Firestore's per-document limit is ~1 MiB; a very long run's track can get close to that. Skip
// the track field rather than fail the whole sync if it would push a document over a safe margin —
// the run's stats still sync, just without the route for that one run.
const MAX_TRACK_JSON_BYTES = 900_000;

let syncing = false;
// Runs already pushed this app session — avoids re-uploading the whole history on every save.
// Resets on cold start, which is fine: the next sync just re-verifies everything once more.
const pushedThisSession = new Set<string>();

/**
 * Two-way sync of run history with Firestore, under users/{uid}/runs/{runId}. Local AsyncStorage
 * (history.ts) stays the source of truth offline — this only adds a backup/multi-device copy on
 * top of it, and never removes a local run just because Firestore doesn't have it yet.
 */
export const syncNow = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user || syncing) return;
  syncing = true;
  try {
    const runsCol = collection(db, 'users', user.uid, 'runs');
    const localRuns = await loadRuns();

    // Push: local runs this session hasn't uploaded yet.
    const toPush = localRuns.filter((r) => !pushedThisSession.has(r.id));
    await Promise.all(
      toPush.map(async (run) => {
        const track = await loadTrack(run.id);
        const trackJson = track.length > 1 ? JSON.stringify(track) : null;
        const payload: Record<string, unknown> = { ...run };
        if (trackJson && trackJson.length <= MAX_TRACK_JSON_BYTES) payload.track = track;
        await setDoc(doc(runsCol, run.id), payload);
        pushedThisSession.add(run.id);
      }),
    );

    // Pull: remote runs this device doesn't have locally yet (e.g. saved on another device).
    const remoteSnap = await getDocs(runsCol);
    const localIds = new Set(localRuns.map((r) => r.id));
    await Promise.all(
      remoteSnap.docs
        .filter((d) => !localIds.has(d.id))
        .map(async (d) => {
          const { track, ...run } = d.data() as Run & { track?: TrackPt[] };
          await saveRun(run as Run, track ?? [], true);
          pushedThisSession.add(d.id);
        }),
    );
  } finally {
    syncing = false;
  }
};

// Forces the next syncNow() to re-check every run, including ones already pushed this session —
// used after runs are edited in place (e.g. migrateMovingTime in migrate.ts recalculating old
// runs' pace), so the corrected values actually make it to Firestore instead of being skipped
// as "already synced".
export const resetSyncCache = () => pushedThisSession.clear();
