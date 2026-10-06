import React from 'react';
import { colors, fontStack } from '../theme';

const W = 390;
const H = 844;

/** A phone-shaped frame so each scene reads as "this is the app on a phone," not a bare rectangle. */
export const PhoneFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      width: W,
      height: H,
      borderRadius: 52,
      border: '10px solid #1a1a1f',
      backgroundColor: colors.bg,
      overflow: 'hidden',
      position: 'relative',
      boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
      fontFamily: fontStack,
    }}
  >
    {/* Notch */}
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 140,
        height: 28,
        backgroundColor: '#1a1a1f',
        borderBottomLeftRadius: 18,
        borderBottomRightRadius: 18,
        zIndex: 10,
      }}
    />
    <div style={{ width: '100%', height: '100%' }}>{children}</div>
  </div>
);

export const phoneSize = { width: W, height: H };
