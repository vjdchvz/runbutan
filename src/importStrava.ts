import { File } from 'expo-file-system';
import { badgesFor, bestEfforts } from './efforts';
import { loadRuns, saveRun, updateRun, type Run } from './history';
import { computeMovingStats } from './movingStats';
import { getSettings } from './settings';
import { readStravaExport, thinTrack, type StravaExport } from './stravaExport';
import { resetSyncCache, syncNow } from './sync';

// A Strava archive also holds every photo you ever uploaded, so it can be large. The whole zip is
// read into memory to find the activities inside it, which is fine for ordinary exports and not for
// multi-hundred-megabyte ones.
const MAX_ZIP_BYTES = 250 * 1024 * 1024;
const SAME_RUN_WINDOW_MS = 5 * 60 * 1000;

/** Opens the system file picker, reads the chosen Strava zip. Null when the picker is cancelled. */
export const pickStravaExport = async (): Promise<StravaExport | null> => {
  const picked = await File.pickFileAsync({ mimeTypes: ['*/*'] });
  if (picked.canceled) return null;
  const file = picked.result;
  if ((file.size ?? 0) > MAX_ZIP_BYTES) {
    throw new Error(
      `That file is ${Math.round((file.size ?? 0) / 1048576)} MB, too big to open on the phone. On a computer, unzip it and zip up just activities.csv and the activities folder, then pick that.`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('That is not a .zip file. Pick the archive Strava emailed you (named like export_12345.zip).');
  }
  return readStravaExport(bytes);
};

export type ImportResult = { imported: number; duplicates: number; routeless: number };

/** Re-rank every run's records oldest to newest, so badges stay right when older runs arrive late. */
export const recomputeBadges = async () => {
  const all = (await loadRuns()).sort((a, b) => a.startedAt - b.startedAt);
  const done: Run[] = [];
  for (const r of all) {
    if (!r.efforts) {
      done.push(r);
      continue;
    }
    const badges = badgesFor(r.efforts, done);
    if (JSON.stringify(badges) !== JSON.stringify(r.badges ?? [])) await updateRun(r.id, { badges });
    done.push({ ...r, badges });
  }
};

/**
 * Saves the parsed Strava runs as normal RUNbutan runs. Strava's own distance, moving time, elapsed
 * time and elevation are kept as they are (they are what Strava shows); the route gives the map,
 * best efforts and km splits. A run already in RUNbutan (same start within 5 minutes, e.g. one you
 * recorded here and uploaded to Strava) is skipped, so importing twice never doubles anything.
 */
export const importStravaRuns = async (
  ex: StravaExport,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> => {
  const t0 = Date.now();
  const starts = (await loadRuns()).map((r) => r.startedAt);
  const unit = getSettings().unit;
  const splitM = unit === 'mi' ? 1609.344 : 1000;
  const result: ImportResult = { imported: 0, duplicates: 0, routeless: 0 };

  for (let i = 0; i < ex.runs.length; i++) {
    const sr = ex.runs[i];
    if (starts.some((s) => Math.abs(s - sr.startedAt) <= SAME_RUN_WINDOW_MS)) {
      result.duplicates++;
    } else {
      const hasRoute = sr.track.length > 1;
      let splits: Run['splits'] = [];
      if (hasRoute) {
        // Splits come from the route with the app's Strava-style moving rule; nudge them so they add
        // up to Strava's own moving time for the run (only when the two are close).
        const calc = computeMovingStats(sr.track, sr.distanceM, splitM);
        const ratio = calc.movingSec > 0 ? sr.movingSec / calc.movingSec : 1;
        const k = ratio > 0.85 && ratio < 1.15 ? ratio : 1;
        splits = calc.splits.map((s) => ({ km: s.km, splitSec: s.splitSec * k, totalSec: s.totalSec * k }));
      } else result.routeless++;

      const run: Run = {
        id: `strava-${sr.activityId}`,
        startedAt: sr.startedAt,
        distanceM: sr.distanceM,
        movingSec: sr.movingSec,
        elapsedSec: sr.elapsedSec,
        ...(sr.elevGainM !== undefined ? { elevGainM: sr.elevGainM } : {}),
        avgPaceSec: sr.movingSec / (sr.distanceM / 1000),
        splits,
        splitUnit: unit,
        ...(sr.title ? { title: sr.title } : {}),
        efforts: hasRoute ? bestEfforts(sr.track) : [],
        source: 'strava',
      };
      await saveRun(run, hasRoute ? thinTrack(sr.track) : [], true);
      starts.push(sr.startedAt);
      result.imported++;
    }
    onProgress?.(i + 1, ex.runs.length);
    if (i % 4 === 3) await new Promise<void>((res) => setTimeout(res, 0)); // let the screen redraw
  }

  if (result.imported) {
    console.log(`[strava-import] saved ${result.imported} runs in ${Date.now() - t0} ms`);
    await recomputeBadges();
    resetSyncCache(); // badges of older runs may have changed: push everything again
    syncNow().catch(() => {});
  }
  return result;
};
