import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors } from '../theme';

/** A mockup of Settings → Account, right after signing in with Google. */
export const SignInContent: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const avatarIn = spring({ frame: frame - 10, fps, config: { damping: 11, mass: 0.6 }, durationInFrames: 16 });
  const avatarScale = interpolate(avatarIn, [0, 1], [0.5, 1]);
  const checkOpacity = interpolate(frame, [26, 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{ width: '100%', height: '100%', paddingTop: 64, paddingLeft: 20, paddingRight: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ color: colors.textDim, fontSize: 11, fontWeight: 800, letterSpacing: 1.4 }}>SETTINGS</div>

      <div style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
        <div style={{ color: colors.textDim, fontSize: 11, fontWeight: 800, letterSpacing: 1.4 }}>ACCOUNT</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, marginBottom: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: colors.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${avatarScale})`,
            }}
          >
            <span style={{ color: '#fff', fontWeight: 900, fontSize: 20 }}>V</span>
          </div>
          <div>
            <div style={{ color: colors.text, fontSize: 15, fontWeight: 700 }}>Victor</div>
            <div style={{ color: colors.textDim, fontSize: 13 }}>victor@gmail.com</div>
          </div>
        </div>
        <div style={{ backgroundColor: '#2A2A35', borderRadius: 12, paddingTop: 12, paddingBottom: 12, textAlign: 'center', opacity: checkOpacity }}>
          <span style={{ color: '#fff', fontWeight: 900, letterSpacing: 1.1, fontSize: 13 }}>☁ SYNCED</span>
        </div>
        <div style={{ color: colors.textDim, fontSize: 13, lineHeight: 1.4, marginTop: 10 }}>
          Your run history backs up here automatically and is available if you sign in on another device.
        </div>
      </div>
    </div>
  );
};
