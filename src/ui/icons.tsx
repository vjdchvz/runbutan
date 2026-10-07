import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';

// Line icons (lucide-style, 24×24 grid, 2px stroke) for the tab bar and header.
type P = { size?: number; color: string; strokeWidth?: number };
const base = (size: number, color: string, sw: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth: sw,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconRun = ({ size = 24, color, strokeWidth = 2 }: P) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Circle cx="14.5" cy="4" r="2" />
    <Path d="M7 21l3.5-6 3 2.5V22" />
    <Path d="M6 12l2.5-3.5 4.5-.5 3 3.5 3 1" />
    <Path d="M10.5 15l2-6.5" />
  </Svg>
);

export const IconHistory = ({ size = 24, color, strokeWidth = 2 }: P) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <Polyline points="3 3 3 8 8 8" />
    <Polyline points="12 7 12 12 15.5 14" />
  </Svg>
);

export const IconCoach = ({ size = 24, color, strokeWidth = 2 }: P) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Circle cx="12" cy="12" r="9" />
    <Circle cx="12" cy="12" r="5" />
    <Circle cx="12" cy="12" r="1" />
  </Svg>
);

export const IconYou = ({ size = 24, color, strokeWidth = 2 }: P) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Rect x="3" y="12" width="4" height="9" rx="1" />
    <Rect x="10" y="7" width="4" height="14" rx="1" />
    <Rect x="17" y="3" width="4" height="18" rx="1" />
  </Svg>
);

export const IconSettings = ({ size = 22, color, strokeWidth = 2 }: P) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <Circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IconVolume = ({ size = 18, color, strokeWidth = 2, muted }: P & { muted?: boolean }) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M11 5L6 9H2v6h4l5 4V5z" />
    {muted ? <Path d="M22 9l-6 6M16 9l6 6" /> : <Path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
  </Svg>
);
