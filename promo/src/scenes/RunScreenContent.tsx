import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { colors } from '../theme';

const ROUTE_POINTS: [number, number][] = [
  [40, 260], [70, 220], [60, 170], [100, 140], [150, 150], [190, 110],
  [210, 70], [180, 40], [140, 55], [110, 90], [130, 130], [170, 160],
  [200, 200], [230, 230], [260, 210], [280, 170],
];

const pathD = (pts: [number, number][]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ flex: 1 }}>
    <div style={{ color: colors.textDim, fontSize: 11, fontWeight: 800, letterSpacing: 1.4 }}>{label}</div>
    <div style={{ color: colors.text, fontSize: 28, fontWeight: 800, marginTop: 2 }}>{value}</div>
  </div>
);

/** A mockup of the RUN screen mid-run: live distance ticking up, a route drawing itself in, GPS bars. */
export const RunScreenContent: React.FC = () => {
  const frame = useCurrentFrame();
  const km = interpolate(frame, [0, 90], [3.4, 5.39], { extrapolateRight: 'clamp' });
  const routeProgress = interpolate(frame, [10, 80], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const drawnCount = Math.max(2, Math.round(ROUTE_POINTS.length * routeProgress));

  return (
    <div style={{ width: '100%', height: '100%', paddingTop: 64, paddingLeft: 20, paddingRight: 20, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ width: 4, height: 4 + i * 4, backgroundColor: colors.good, borderRadius: 1 }} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ color: colors.textDim, fontSize: 12, fontWeight: 800, letterSpacing: 1.4 }}>DISTANCE</div>
        <div style={{ color: colors.text, fontSize: 64, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
          {km.toFixed(2)} <span style={{ fontSize: 28, color: colors.textDim }}>km</span>
        </div>
      </div>

      <div style={{ display: 'flex', marginTop: 20 }}>
        <Stat label="PACE" value="5:42 /km" />
        <Stat label="TIME" value="28:41" />
        <Stat label="AVG PACE" value="5:50 /km" />
      </div>

      <div style={{ marginTop: 24, backgroundColor: colors.card, borderRadius: 20, flex: 1, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="320" height="300" viewBox="0 0 320 300">
          <path d={pathD(ROUTE_POINTS.slice(0, drawnCount))} fill="none" stroke={colors.accent} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={ROUTE_POINTS[drawnCount - 1][0]} cy={ROUTE_POINTS[drawnCount - 1][1]} r={9} fill={colors.accent} />
        </svg>
      </div>

      <div style={{ marginTop: 20, marginBottom: 36, backgroundColor: colors.accent, borderRadius: 16, paddingTop: 18, paddingBottom: 18, textAlign: 'center' }}>
        <span style={{ color: '#fff', fontSize: 18, fontWeight: 900, letterSpacing: 1.5 }}>PAUSE</span>
      </div>
    </div>
  );
};
