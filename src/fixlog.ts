import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { saveToDownloads } from '../modules/runkit';
import { loadFixLog, type Run } from './history';

// The per-fix GPS record of a run as a CSV, so it can be copied to a computer and replayed against
// Strava's version of the same run. Columns follow FixLogRow in session.ts.
const HEADER = 't_ms,time_utc,lat,lon,accuracy_m,speed_ms,altitude_m,altitude_acc_m,decision,added_m,distance_m,moving_ms';

export const exportFixLog = async (run: Run): Promise<string> => {
  const rows = await loadFixLog(run.id);
  if (!rows?.length) throw new Error('No GPS log was kept for this run. Only runs recorded with this version of the app have one.');
  const d = new Date(run.startedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const name = `runbutan-gps-log-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
  const csv =
    `# RUNbutan GPS log v1 | run ${run.id} | app distance ${run.distanceM.toFixed(1)} m | moving ${Math.round(run.movingSec)} s | elapsed ${Math.round(run.elapsedSec ?? run.movingSec)} s\n` +
    HEADER +
    '\n' +
    rows.map((r) => [r[0], new Date(r[0]).toISOString(), ...r.slice(1).map((v) => (v === null ? '' : v))].join(',')).join('\n') +
    '\n';
  if (Platform.OS === 'android') return saveToDownloads(name, csv, 'text/csv');
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Share the GPS log' });
  return name;
};
