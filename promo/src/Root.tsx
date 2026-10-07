import React from 'react';
import { Composition } from 'remotion';
import { Demo, TOTAL_DURATION } from './Demo';

export const Root: React.FC = () => (
  <Composition
    id="demo"
    component={Demo}
    durationInFrames={TOTAL_DURATION}
    fps={30}
    width={1920}
    height={1080}
  />
);
