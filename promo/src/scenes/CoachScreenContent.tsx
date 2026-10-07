import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors } from '../theme';

/** A mockup of the Coach tab's "Today" card, with the adaptive-coaching banner sliding in. */
export const CoachScreenContent: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bannerIn = spring({ frame: frame - 28, fps, config: { damping: 14 }, durationInFrames: 16 });
  const bannerOpacity = interpolate(bannerIn, [0, 1], [0, 1]);
  const bannerX = interpolate(bannerIn, [0, 1], [-24, 0]);

  return (
    <div style={{ width: '100%', height: '100%', paddingTop: 64, paddingLeft: 20, paddingRight: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ color: colors.textDim, fontSize: 11, fontWeight: 800, letterSpacing: 1.4 }}>COACH</div>

      <div style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
        <div style={{ color: colors.textDim, fontSize: 11, fontWeight: 800, letterSpacing: 1.4 }}>TODAY · 10K TO HALF MARATHON</div>
        <div style={{ color: colors.text, fontSize: 20, fontWeight: 900, marginTop: 6 }}>Week 6 · Run 3</div>
        <div style={{ color: colors.textDim, fontSize: 15, marginTop: 4 }}>Long run · 17 km · ~95 min</div>

        <div
          style={{
            opacity: bannerOpacity > 0 ? bannerOpacity : 0,
            transform: `translateX(${bannerX}px)`,
            color: colors.warn,
            fontSize: 15,
            fontWeight: 700,
            marginTop: 10,
          }}
        >
          {frame >= 28 ? '🤖 Eased 15% — your last few long runs ran tougher than planned.' : ''}
        </div>

        <div style={{ backgroundColor: colors.accent, borderRadius: 14, paddingTop: 15, paddingBottom: 15, textAlign: 'center', marginTop: 16 }}>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 900, letterSpacing: 1.1 }}>OPEN SESSION</span>
        </div>
      </div>

      <div style={{ color: colors.textDim, fontSize: 12, fontWeight: 800, letterSpacing: 1.5 }}>TRAINING PLANS</div>
      {[
        { name: '10K to Half Marathon', level: 'INTERMEDIATE', active: true },
        { name: 'Half to Marathon', level: 'ADVANCED', active: false },
        { name: 'Marathon to Ultra', level: 'ADVANCED', active: false },
      ].map((p) => (
        <div key={p.name} style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: colors.text, fontSize: 18, fontWeight: 900 }}>{p.name}</div>
            <div style={{ color: colors.textDim, fontSize: 10, fontWeight: 800, letterSpacing: 1.2, backgroundColor: '#22222C', paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 6 }}>
              {p.level}
            </div>
          </div>
          <div style={{ color: colors.accent, fontWeight: 800, marginTop: 8, fontSize: 13 }}>
            {p.active ? 'Continue · 15/27 done' : 'Start this plan ›'}
          </div>
        </div>
      ))}
    </div>
  );
};
