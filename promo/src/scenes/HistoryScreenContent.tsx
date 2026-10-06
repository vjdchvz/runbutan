import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { colors } from '../theme';

const WEEKS = [2.1, 3.4, 2.8, 4.9, 5.5, 4.2, 6.8, 7.1, 5.9, 8.3, 7.6, 9.2];

/** A mockup of History: a run card plus the 12-week bar chart growing in. */
export const HistoryScreenContent: React.FC = () => {
  const frame = useCurrentFrame();
  const max = Math.max(...WEEKS);

  return (
    <div style={{ width: '100%', height: '100%', paddingTop: 64, paddingLeft: 20, paddingRight: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ color: colors.textDim, fontSize: 11, fontWeight: 800, letterSpacing: 1.4 }}>HISTORY</div>

      <div style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
        <div style={{ color: colors.textDim, fontSize: 11, fontWeight: 800, letterSpacing: 1.4 }}>PAST 12 WEEKS · KM</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, marginTop: 14 }}>
          {WEEKS.map((km, i) => {
            const grow = interpolate(frame, [i * 3, i * 3 + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            const h = Math.max(3, (km / max) * 100 * grow);
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: h,
                  backgroundColor: i === WEEKS.length - 1 ? colors.accent : '#8A3A2A',
                  borderRadius: 3,
                }}
              />
            );
          })}
        </div>
      </div>

      <div style={{ color: colors.textDim, fontSize: 12, fontWeight: 800, letterSpacing: 1.5, marginTop: 4 }}>RECENT RUNS</div>
      {[
        { title: 'Morning run', dist: '9.20 km', pace: '5:38 /km', splits: '12 KM SPLITS' },
        { title: 'Long run · Saturday', dist: '17.04 km', pace: '6:02 /km', splits: '17 KM SPLITS' },
      ].map((r) => (
        <div key={r.title} style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ color: colors.text, fontSize: 17, fontWeight: 800 }}>{r.title}</div>
            <div style={{ color: colors.text, fontSize: 17, fontWeight: 800 }}>{r.dist}</div>
          </div>
          <div style={{ color: colors.textDim, fontSize: 13, marginTop: 4 }}>{r.pace} avg</div>
          <div style={{ color: colors.textDim, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, marginTop: 10 }}>{r.splits}</div>
        </div>
      ))}
    </div>
  );
};
