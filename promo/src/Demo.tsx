import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { Intro } from './scenes/Intro';
import { Outro } from './scenes/Outro';
import { SceneLayout } from './components/SceneLayout';
import { RunScreenContent } from './scenes/RunScreenContent';
import { CoachScreenContent } from './scenes/CoachScreenContent';
import { HistoryScreenContent } from './scenes/HistoryScreenContent';
import { SignInContent } from './scenes/SignInContent';

// 30fps. Each Sequence re-bases useCurrentFrame() to 0 for its children, so every scene's own
// animation timing (see each scenes/*.tsx) is relative to its own start, not the timeline below.
const T = {
  intro: { from: 0, duration: 60 }, // 2s
  run: { from: 60, duration: 180 }, // 6s
  coach: { from: 240, duration: 240 }, // 8s — longest: this is the differentiator
  history: { from: 480, duration: 180 }, // 6s
  signIn: { from: 660, duration: 180 }, // 6s
  outro: { from: 840, duration: 120 }, // 4s
};

export const TOTAL_DURATION = T.outro.from + T.outro.duration; // 960 frames = 32s

export const Demo: React.FC = () => (
  <AbsoluteFill>
    <Sequence from={T.intro.from} durationInFrames={T.intro.duration}>
      <Intro />
    </Sequence>
    <Sequence from={T.run.from} durationInFrames={T.run.duration}>
      <SceneLayout headline="Track every run. No signal required." caption="GPS tracking that works offline — pace, splits, route, all on your phone.">
        <RunScreenContent />
      </SceneLayout>
    </Sequence>
    <Sequence from={T.coach.from} durationInFrames={T.coach.duration}>
      <SceneLayout headline="Training that adapts to you." caption="Not a fixed script — the next session eases or pushes based on how training's actually going.">
        <CoachScreenContent />
      </SceneLayout>
    </Sequence>
    <Sequence from={T.history.from} durationInFrames={T.history.duration}>
      <SceneLayout headline="Every run, every split, saved." caption="Full history and stats, stored locally — nothing required to leave your phone.">
        <HistoryScreenContent />
      </SceneLayout>
    </Sequence>
    <Sequence from={T.signIn.from} durationInFrames={T.signIn.duration}>
      <SceneLayout headline="Back it up, when you want to." caption="Optional Google sign-in syncs your history — everything still works fully offline.">
        <SignInContent />
      </SceneLayout>
    </Sequence>
    <Sequence from={T.outro.from} durationInFrames={T.outro.duration}>
      <Outro />
    </Sequence>
  </AbsoluteFill>
);
