import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors, fontStack } from '../theme';
import { PhoneFrame } from './PhoneFrame';

type Props = {
  headline: string;
  caption: string;
  children: React.ReactNode;
};

/** The common shape every feature scene shares: a headline, the phone mockup, a caption below. */
export const SceneLayout: React.FC<Props> = ({ headline, caption, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  const phoneY = interpolate(enter, [0, 1], [40, 0]);
  const phoneOpacity = enter;
  const textOpacity = interpolate(frame, [4, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const textY = interpolate(frame, [4, 16], [16, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: fontStack,
      }}
    >
      <div style={{ height: 160, display: 'flex', alignItems: 'center', opacity: textOpacity, transform: `translateY(${textY}px)` }}>
        <div style={{ color: colors.text, fontSize: 44, fontWeight: 800, textAlign: 'center', maxWidth: 1400 }}>{headline}</div>
      </div>
      <div style={{ opacity: phoneOpacity, transform: `translateY(${phoneY}px)` }}>
        <PhoneFrame>{children}</PhoneFrame>
      </div>
      <div style={{ height: 76, display: 'flex', alignItems: 'center', opacity: textOpacity }}>
        <div style={{ color: colors.textDim, fontSize: 24, fontWeight: 600, textAlign: 'center' }}>{caption}</div>
      </div>
    </div>
  );
};
