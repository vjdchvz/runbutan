import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
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
  const stamp = new Date(run.startedAt).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const name = `RUNbutan ${(run.distanceM / 1000).toFixed(2)} km`;
  const file = new File(Paths.cache, `runbutan-${stamp}.gpx`);
  if (file.exists) file.delete();
  file.create();
  file.write(buildGpx(name, track));
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/gpx+xml',
    dialogTitle: 'Share run (choose Strava)',
    UTI: 'com.topografix.gpx',
  });
};
