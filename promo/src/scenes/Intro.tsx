import React from 'react';
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors, fontStack } from '../theme';

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoIn = spring({ frame, fps, config: { damping: 12, mass: 0.6 }, durationInFrames: 24 });
  const logoScale = interpolate(logoIn, [0, 1], [0.4, 1]);
  const logoOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });

  const wordmarkOpacity = interpolate(frame, [16, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const wordmarkY = interpolate(frame, [16, 28], [14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const taglineOpacity = interpolate(frame, [32, 44], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

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
      <div style={{ opacity: logoOpacity, transform: `scale(${logoScale})`, width: 220, height: 149 }}>
        <Img src={staticFile('logo-mark.png')} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
      <div style={{ opacity: wordmarkOpacity, transform: `translateY(${wordmarkY}px)`, fontSize: 88, letterSpacing: 1, marginTop: 24 }}>
        <span style={{ color: colors.brandRun, fontWeight: 900, fontStyle: 'italic' }}>RUN</span>
        <span style={{ color: colors.brandButan, fontWeight: 700 }}>butan</span>
      </div>
      <div style={{ opacity: taglineOpacity, color: colors.textDim, fontSize: 30, fontWeight: 600, marginTop: 18 }}>
        A free, offline-first running coach.
      </div>
    </div>
  );
};
