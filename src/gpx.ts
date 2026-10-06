import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { saveToDownloads } from '../modules/runkit';
import { cleanTrack } from './gpxClean';
import type { Run } from './history';
import type { TrackPt } from './session';

const iso = (t: number) => new Date(t).toISOString();

export const buildGpx = (name: string, track: TrackPt[]) => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RUNbutan" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>${iso(track[0].t)}</time></metadata>
  <trk>
    <name>${name}</name>
    <type>running</type>
    <trkseg>
${track.map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.ele !== undefined ? `<ele>${p.ele}</ele>` : ''}<time>${iso(p.t)}</time></trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>
`;

export const shareGpx = async (run: Run, track: TrackPt[]) => {
  if (track.length < 2) throw new Error('This run has no saved route.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  const name = `RUNbutan ${(run.distanceM / 1000).toFixed(2)} km`;
  const file = new File(Paths.cache, `${fileStem(run)}.gpx`);
  if (file.exists) file.delete();
  file.create();
  file.write(buildGpx(name, cleanTrack(track)));
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/gpx+xml',
    dialogTitle: 'Share run (choose Strava)',
    UTI: 'com.topografix.gpx',
  });
};

export const STRAVA_UPLOAD_URL = 'https://www.strava.com/upload/select';

// Local time in the name (the same clock the run shows in History), e.g. runbutan-20261006-1153.gpx
const pad2 = (n: number) => String(n).padStart(2, '0');
const fileStem = (run: Run) => {
  const d = new Date(run.startedAt);
  return `runbutan-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
};

// Writes the run's GPX into the phone's Downloads folder (so a website's file picker can see it).
// Resolves with the file name that was actually used.
export const saveGpxToDownloads = async (run: Run, track: TrackPt[]) => {
  if (track.length < 2) throw new Error('This run has no saved route.');
  const name = `RUNbutan ${(run.distanceM / 1000).toFixed(2)} km`;
  return saveToDownloads(`${fileStem(run)}.gpx`, buildGpx(name, cleanTrack(track)), 'application/gpx+xml');
};
