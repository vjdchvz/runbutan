import { gunzipSync, strFromU8, unzipSync } from 'fflate';
import { haversine } from './gpxClean';
import type { TrackPt } from './session';

// Reads the archive Strava emails you (Settings → My Account → Download or Delete Your Account →
// Request Your Archive): export_XXXX.zip with activities.csv (one row per activity: name, date,
// times, distance, elevation ...) and an activities/ folder holding each activity's original file
// (.gpx / .tcx / .fit, sometimes gzipped). Pure code, no React Native imports, so it can be tested
// on a computer against a real export.

export type StravaRun = {
  activityId: string;
  startedAt: number; // ms since epoch
  title?: string;
  distanceM: number;
  movingSec: number;
  elapsedSec: number;
  elevGainM?: number;
  track: TrackPt[]; // full resolution (Strava's GPX is ~1 point a second); [] when no readable route
};

export type StravaExport = {
  runs: StravaRun[];
  skippedTypes: Record<string, number>; // activities that are not runs, e.g. { Ride: 12, Walk: 3 }
  tooShort: number; // runs under 50 m (accidental starts, empty manual entries)
  unreadable: number; // rows with no usable date
  routeless: number; // runs imported without a map (manual entry, or a .fit file)
};

// What the app treats as a run. Rides, walks, swims etc. are left out so averages and records stay runs.
const RUN_TYPES = new Set(['run', 'trail run', 'virtual run']);
const MIN_DISTANCE_M = 50;

// ---------- text decoding ----------
// fflate's own strFromU8 falls back to appending ONE character at a time when the engine has no
// TextDecoder (Hermes on Android), which is quadratic for a 400 KB route file: minutes of CPU on a
// phone. Decode in 8 K-character chunks instead.
const CHUNK = 8192;
const asAscii = (u8: Uint8Array): string => strFromU8(u8, true); // chunked String.fromCharCode.apply

export const decodeUtf8 = (u8: Uint8Array): string => {
  const parts: string[] = [];
  let buf: number[] = [];
  for (let i = 0; i < u8.length; ) {
    const c = u8[i++];
    let cp = c;
    if (c >= 0xf0) cp = ((c & 7) << 18) | ((u8[i++] & 63) << 12) | ((u8[i++] & 63) << 6) | (u8[i++] & 63);
    else if (c >= 0xe0) cp = ((c & 15) << 12) | ((u8[i++] & 63) << 6) | (u8[i++] & 63);
    else if (c >= 0xc0) cp = ((c & 31) << 6) | (u8[i++] & 63);
    if (cp > 0xffff) {
      cp -= 0x10000;
      buf.push(0xd800 | (cp >> 10), 0xdc00 | (cp & 1023));
    } else buf.push(cp);
    if (buf.length >= CHUNK) {
      parts.push(String.fromCharCode.apply(null, buf));
      buf = [];
    }
  }
  if (buf.length) parts.push(String.fromCharCode.apply(null, buf));
  return parts.join('');
};

// ---------- CSV (quoted fields, doubled quotes, line breaks inside quotes) ----------
export const parseCsv = (input: string): string[][] => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
};

// Strava's header repeats names ("Distance" and "Elapsed Time" appear twice: a display column, then
// the numeric one in metres/seconds), so look up by name and say whether the first or last wins.
const colIndex = (header: string[], name: string, last = false) => {
  let found = -1;
  header.forEach((c, i) => {
    if (c.trim() === name && (last || found < 0)) found = i;
  });
  return found;
};
const num = (s: string | undefined) => {
  const n = parseFloat(s ?? '');
  return isFinite(n) ? n : undefined;
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "Oct 5, 2026, 8:56:09 AM" (UTC). Only used for activities without a route file.
export const parseStravaDate = (s: string): number | null => {
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i.exec(s.trim());
  if (m) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    if (mo >= 0) {
      let h = +m[4];
      if (m[7]) h = (h % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0);
      return Date.UTC(+m[3], mo, +m[2], h, +m[5], +m[6]);
    }
  }
  const t = Date.parse(s);
  return isFinite(t) ? t : null;
};

// ---------- route files ----------
// Plain indexOf scanning (no regular expressions): linear and fast on every JS engine.
const attrOf = (head: string, name: string) => {
  const i = head.indexOf(name + '="');
  if (i < 0) return null;
  const from = i + name.length + 2;
  const j = head.indexOf('"', from);
  return j < 0 ? null : head.slice(from, j);
};
const between = (s: string, open: string, close: string) => {
  const i = s.indexOf(open);
  if (i < 0) return null;
  const j = s.indexOf(close, i + open.length);
  return j < 0 ? null : s.slice(i + open.length, j);
};

export const parseGpx = (xml: string): TrackPt[] => {
  const out: TrackPt[] = [];
  let i = 0;
  for (;;) {
    const s0 = xml.indexOf('<trkpt', i);
    if (s0 < 0) break;
    const gt = xml.indexOf('>', s0);
    if (gt < 0) break;
    let body = '';
    i = gt + 1;
    if (xml.charCodeAt(gt - 1) !== 47) {
      const e = xml.indexOf('</trkpt>', gt);
      if (e < 0) break;
      body = xml.slice(gt + 1, e);
      i = e + 8;
    }
    const head = xml.slice(s0 + 6, gt);
    const lat = attrOf(head, 'lat');
    const lon = attrOf(head, 'lon');
    const time = between(body, '<time>', '</time>');
    if (lat === null || lon === null || time === null) continue;
    const t = Date.parse(time);
    if (!isFinite(t)) continue;
    const p: TrackPt = { t, lat: +lat, lon: +lon };
    const ele = between(body, '<ele>', '</ele>');
    if (ele !== null && isFinite(+ele)) p.ele = +ele;
    out.push(p);
  }
  return out;
};

export const parseTcx = (xml: string): TrackPt[] => {
  const out: TrackPt[] = [];
  let i = 0;
  for (;;) {
    const s0 = xml.indexOf('<Trackpoint>', i);
    if (s0 < 0) break;
    const e = xml.indexOf('</Trackpoint>', s0);
    if (e < 0) break;
    const body = xml.slice(s0 + 12, e);
    i = e + 13;
    const time = between(body, '<Time>', '</Time>');
    const lat = between(body, '<LatitudeDegrees>', '</LatitudeDegrees>');
    const lon = between(body, '<LongitudeDegrees>', '</LongitudeDegrees>');
    if (time === null || lat === null || lon === null) continue;
    const t = Date.parse(time);
    if (!isFinite(t)) continue;
    const p: TrackPt = { t, lat: +lat, lon: +lon };
    const ele = between(body, '<AltitudeMeters>', '</AltitudeMeters>');
    if (ele !== null && isFinite(+ele)) p.ele = +ele;
    out.push(p);
  }
  return out;
};

const cleanOrder = (pts: TrackPt[]) => {
  let ordered = true;
  for (let i = 1; i < pts.length && ordered; i++) if (pts[i].t < pts[i - 1].t) ordered = false;
  const sorted = ordered ? pts : pts.slice().sort((a, b) => a.t - b.t);
  return sorted.filter((p, i) => i === 0 || p.t > sorted[i - 1].t);
};

// Keeps a point every >= minGapMs (and the last): the app stores a route as ~2 s points, and Android
// storage is limited, so a long Strava history must not be kept at 1 Hz. Efforts and splits are
// computed from the full-resolution track BEFORE this.
export const thinTrack = (track: TrackPt[], minGapMs = 3000): TrackPt[] => {
  if (track.length < 3) return track;
  const out = [track[0]];
  let last = track[0].t;
  for (let i = 1; i < track.length - 1; i++) {
    if (track[i].t - last >= minGapMs) {
      out.push(track[i]);
      last = track[i].t;
    }
  }
  out.push(track[track.length - 1]);
  return out;
};

const trackLength = (t: TrackPt[]) => {
  let d = 0;
  for (let i = 1; i < t.length; i++) d += haversine(t[i - 1], t[i]);
  return d;
};

// ---------- the whole archive ----------
export const readStravaExport = (zip: Uint8Array): StravaExport => {
  const t0 = Date.now();
  const files = unzipSync(zip, {
    filter: (f) => /(^|\/)activities\.csv$/.test(f.name) || /(^|\/)activities\/[^/]+$/.test(f.name),
  });
  const tUnzip = Date.now() - t0;
  const names = Object.keys(files);
  const csvName = names.find((n) => /(^|\/)activities\.csv$/.test(n));
  if (!csvName) throw new Error("This doesn't look like a Strava export: activities.csv is missing from the zip.");

  const rows = parseCsv(decodeUtf8(files[csvName]));
  if (rows.length < 2) return { runs: [], skippedTypes: {}, tooShort: 0, unreadable: 0, routeless: 0 };
  const h = rows[0];
  const c = {
    id: colIndex(h, 'Activity ID'),
    date: colIndex(h, 'Activity Date'),
    name: colIndex(h, 'Activity Name'),
    type: colIndex(h, 'Activity Type'),
    file: colIndex(h, 'Filename'),
    elapsed: colIndex(h, 'Elapsed Time', true),
    moving: colIndex(h, 'Moving Time'),
    dist: colIndex(h, 'Distance', true),
    elev: colIndex(h, 'Elevation Gain'),
  };
  if (c.id < 0 || c.type < 0) throw new Error('This Strava export has an activities.csv in a format RUNbutan does not recognise.');

  const byBase = new Map(names.map((n) => [n.split('/').pop() as string, n]));
  const out: StravaExport = { runs: [], skippedTypes: {}, tooShort: 0, unreadable: 0, routeless: 0 };

  for (const r of rows.slice(1)) {
    const type = (r[c.type] ?? '').trim();
    if (!RUN_TYPES.has(type.toLowerCase())) {
      const k = type || 'Other';
      out.skippedTypes[k] = (out.skippedTypes[k] ?? 0) + 1;
      continue;
    }

    // The route: .gpx / .tcx, either plain or gzipped. .fit is binary and not read yet.
    let track: TrackPt[] = [];
    const fname = (r[c.file] ?? '').trim();
    const entry = fname ? (files[fname] ? fname : byBase.get(fname.split('/').pop() as string)) : undefined;
    if (entry) {
      try {
        const gz = /\.gz$/i.test(entry);
        const ext = entry.replace(/\.gz$/i, '').split('.').pop()?.toLowerCase();
        if (ext === 'gpx' || ext === 'tcx') {
          const xml = asAscii(gz ? gunzipSync(files[entry]) : files[entry]);
          track = cleanOrder(ext === 'gpx' ? parseGpx(xml) : parseTcx(xml));
        }
      } catch {
        track = [];
      }
    }

    const startedAt = track.length ? track[0].t : parseStravaDate(r[c.date] ?? '');
    if (startedAt === null) {
      out.unreadable++;
      continue;
    }
    const elapsedSec = num(r[c.elapsed]) ?? (track.length > 1 ? (track[track.length - 1].t - track[0].t) / 1000 : 0);
    const movingSec = num(r[c.moving]) ?? elapsedSec;
    const distanceM = num(r[c.dist]) ?? (track.length > 1 ? trackLength(track) : 0);
    if (distanceM < MIN_DISTANCE_M || movingSec <= 0) {
      out.tooShort++;
      continue;
    }
    if (track.length < 2) out.routeless++;
    out.runs.push({
      activityId: r[c.id].trim(),
      startedAt,
      title: (r[c.name] ?? '').trim() || undefined,
      distanceM,
      movingSec,
      elapsedSec: Math.max(elapsedSec, movingSec),
      elevGainM: num(r[c.elev]),
      track,
    });
  }
  out.runs.sort((a, b) => a.startedAt - b.startedAt);
  console.log(`[strava-import] ${out.runs.length} runs read in ${Date.now() - t0} ms (unzip ${tUnzip} ms)`);
  return out;
};
