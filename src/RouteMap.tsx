import { useCallback, useEffect, useState } from 'react';
import { Image, ImageStyle, LayoutChangeEvent, StyleProp, StyleSheet, Text, View } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import type { TrackPt } from './session';
import { unitMeters, unitName } from './units';

// Route map in Web-Mercator space. OpenStreetMap tiles are drawn underneath when there is
// signal; without signal the metre grid stays visible, so the map never depends on data.
// OSM tile policy: HTTPS, identifying User-Agent, visible attribution, only tiles being viewed.
const NICE = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const MIN_SPAN_M = 200;
const PAD = 28;
const M_PER_UNIT_Z0 = 40075016.686 / 256; // metres per world unit at zoom 0, at the equator
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const TILE_HEADERS = { 'User-Agent': 'RUNbutan/1.0 (personal running app)' };

const worldX = (lon: number) => ((lon + 180) / 360) * 256;
const worldY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256;
};

// RN's <Image> ignores a custom User-Agent (OSM then serves a 403 "blocked" tile), so tiles are
// downloaded once through expo-file-system with our headers and kept in the cache dir
// (policy: cache tiles; only fetch what is viewed). Cached tiles also work with no signal.
function Tile({ z, x, y, style, onOk }: { z: number; x: number; y: number; style: StyleProp<ImageStyle>; onOk: () => void }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dir = new Directory(Paths.cache, 'osm-tiles', String(z), String(x));
        dir.create({ intermediates: true, idempotent: true });
        const file = new File(dir, `${y}.png`);
        if (file.exists && (file.size ?? 0) < 200) file.delete(); // truncated by an interrupted download
        if (!file.exists) await File.downloadFileAsync(TILE_URL(z, x, y), file, { headers: TILE_HEADERS, idempotent: true });
        if (alive) {
          setUri(file.uri);
          onOk();
        }
      } catch {
        // offline / blocked: leave the tile empty, the metre grid stays visible
      }
    })();
    return () => {
      alive = false;
    };
  }, [z, x, y, onOk]);
  const dropBad = () => {
    // a cached file that can't be drawn would otherwise stay broken forever: delete it so it re-downloads
    try {
      if (uri) new File(uri).delete();
    } catch {
      // already gone
    }
    setUri(null);
  };
  return uri ? <Image source={{ uri }} style={style} onError={dropBad} /> : null;
}

// (Math.min(...array) breaks on very long routes: too many arguments.)
const range = (a: number[]): [number, number] => {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
};

type Props = { points: TrackPt[]; height?: number; emptyText?: string; plain?: boolean; follow?: boolean };

const FOLLOW_SPAN_M = 110; // follow mode: the map is always about this many metres wide, centred on you

export default function RouteMap({ points, height = 240, emptyText = 'Waiting for GPS…', plain = false, follow = false }: Props) {
  const [w, setW] = useState(0);
  const [tilesOk, setTilesOk] = useState(false);
  const markOk = useCallback(() => setTilesOk(true), []);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const content = (() => {
    if (!w || points.length < 1) return null;
    const wp = points.map((p) => ({ x: worldX(p.lon), y: worldY(p.lat) }));
    const xs = wp.map((p) => p.x);
    const ys = wp.map((p) => p.y);
    const latC = points.reduce((a, p) => a + p.lat, 0) / points.length;
    const mPerUnit = M_PER_UNIT_Z0 * Math.cos((latC * Math.PI) / 180);
    const minSpan = MIN_SPAN_M / mPerUnit;
    const pad = plain ? 14 : PAD;
    let S: number, cx: number, cy: number;
    if (follow) {
      // you are always the centre; the zoom stays fixed so the route trails behind you
      cx = wp[wp.length - 1].x;
      cy = wp[wp.length - 1].y;
      S = (w / FOLLOW_SPAN_M) * mPerUnit;
    } else {
      const [minX, maxX] = range(xs);
      const [minY, maxY] = range(ys);
      S = Math.min((w - 2 * pad) / Math.max(maxX - minX, minSpan), (height - 2 * pad) / Math.max(maxY - minY, minSpan));
      cx = (minX + maxX) / 2;
      cy = (minY + maxY) / 2;
    }
    const sx = (x: number) => w / 2 + (x - cx) * S;
    const sy = (y: number) => height / 2 + (y - cy) * S;

    // Tiles: pick the zoom whose tiles render at 256–512 px.
    const z = Math.max(2, Math.min(19, Math.floor(Math.log2(S))));
    const tileUnits = 256 / 2 ** z;
    const tilePx = tileUnits * S;
    const n = 2 ** z;
    const tiles: { key: string; z: number; x: number; y: number; left: number; top: number }[] = [];
    const tx0 = Math.floor((cx - w / 2 / S) / tileUnits), tx1 = Math.floor((cx + w / 2 / S) / tileUnits);
    const ty0 = Math.floor((cy - height / 2 / S) / tileUnits), ty1 = Math.floor((cy + height / 2 / S) / tileUnits);
    for (let ty = Math.max(0, ty0); ty <= Math.min(n - 1, ty1); ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const x = ((tx % n) + n) % n;
        tiles.push({ key: `${z}/${x}/${ty}/${tx}`, z, x, y: ty, left: sx(tx * tileUnits), top: sy(ty * tileUnits) });
      }
    }

    // Grid + scale bar in metres (offline fallback).
    const ppm = S / mPerUnit; // px per metre
    const step = NICE.find((s) => s * ppm >= 40) ?? NICE[NICE.length - 1];
    const stepPx = step * ppm;
    const vLines: number[] = [];
    const hLines: number[] = [];
    for (let x = (w / 2) % stepPx; x <= w; x += stepPx) vLines.push(x);
    for (let y = (height / 2) % stepPx; y <= height; y += stepPx) hLines.push(y);

    const pts = wp.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    const first = wp[0];
    const single = wp.length < 2; // idle: just show where you are, no route yet
    const last = wp[wp.length - 1];
    const ink = tilesOk ? '#222' : '#8A8A96';
    return (
      <>
        {(plain ? [] : tiles).map((t) => (
          <Tile
            key={t.key}
            z={t.z}
            x={t.x}
            y={t.y}
            style={{ position: 'absolute', left: t.left, top: t.top, width: tilePx + 0.5, height: tilePx + 0.5 }}
            onOk={markOk}
          />
        ))}
        <Svg width={w} height={height} style={StyleSheet.absoluteFill}>
          {!plain && !tilesOk && vLines.map((x, i) => <Line key={`v${i}`} x1={x} y1={0} x2={x} y2={height} stroke="#1F1F29" strokeWidth={1} />)}
          {!plain && !tilesOk && hLines.map((y, i) => <Line key={`h${i}`} x1={0} y1={y} x2={w} y2={y} stroke="#1F1F29" strokeWidth={1} />)}
          {!single && !plain && <Polyline points={pts} fill="none" stroke="#fff" strokeWidth={9} strokeOpacity={0.9} strokeLinejoin="round" strokeLinecap="round" />}
          {!single && <Polyline points={pts} fill="none" stroke="#FF4D2E" strokeWidth={plain ? 3 : 5} strokeLinejoin="round" strokeLinecap="round" />}
          {!single && <Circle cx={sx(first.x)} cy={sy(first.y)} r={7} fill="#3CB043" stroke="#fff" strokeWidth={2.5} />}
          <Circle cx={sx(last.x)} cy={sy(last.y)} r={7} fill="#fff" stroke="#FF4D2E" strokeWidth={3.5} />
          {!plain && <Line x1={12} y1={height - 16} x2={12 + stepPx} y2={height - 16} stroke={ink} strokeWidth={3} />}
          {!plain && (
            <SvgText x={12} y={height - 24} fill={ink} fontSize={11} fontWeight="700">
              {step >= 1000 ? `${+(step / unitMeters()).toFixed(1)} ${unitName()}` : `${step} m`}
            </SvgText>
          )}
          {!plain && <SvgText x={w - 20} y={22} fill={ink} fontSize={12} fontWeight="800">N</SvgText>}
        </Svg>
        {tilesOk && <Text style={styles.attrib}>© OpenStreetMap contributors</Text>}
      </>
    );
  })();

  return (
    <View style={[styles.box, { height }]} onLayout={onLayout}>
      {content ?? <Text style={styles.empty}>{emptyText}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#101016', borderRadius: 14, overflow: 'hidden', justifyContent: 'center' },
  empty: { color: '#55555F', textAlign: 'center', fontWeight: '700' },
  attrib: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    fontSize: 10,
    color: '#333',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
});
