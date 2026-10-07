import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { colors, fontStack } from '../theme';

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const taglineOpacity = interpolate(frame, [14, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ctaOpacity = interpolate(frame, [28, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: fontStack,
      }}
    >
      <div style={{ opacity, display: 'flex', alignItems: 'center', gap: 20 }}>
        <Img src={staticFile('logo-mark.png')} style={{ width: 90, height: 61, objectFit: 'contain' }} />
        <div style={{ fontSize: 56 }}>
          <span style={{ color: colors.brandRun, fontWeight: 900, fontStyle: 'italic' }}>RUN</span>
          <span style={{ color: colors.brandButan, fontWeight: 700 }}>butan</span>
        </div>
      </div>
      <div style={{ opacity: taglineOpacity, color: colors.text, fontSize: 34, fontWeight: 800, marginTop: 28, textAlign: 'center' }}>
        Free. Offline. Yours.
      </div>
      <div style={{ opacity: ctaOpacity, color: colors.accent, fontSize: 24, fontWeight: 700, marginTop: 16 }}>
        github.com/vjdchvz/runbutan
      </div>
    </div>
  );
};
