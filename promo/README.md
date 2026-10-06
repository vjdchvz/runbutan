# RUNbutan demo video

A ~32-second animated feature tour, built with [Remotion](https://remotion.dev) (React → video) — a
UI mockup matching the real app's dark theme and colors exactly (see `src/theme.ts`, pulled
straight from `App.tsx`/`src/CoachScreen.tsx`), not a screen recording. Scenes: intro → live run
tracking → adaptive coaching (the headline differentiator — see the root README's "Coach tab"
section) → history/stats → Google sign-in → outro.

This is a separate npm project from the app itself (`package.json`, own deps) — it never ships in
the Expo bundle.

## Render it

Needs network access to `remotion.media` (Remotion downloads its own headless Chromium on first
render) — if you hit `403 ... Host not in allowlist`, that host needs adding under your
environment's Custom allowed domains.

```bash
cd promo
npm install
npm run render        # → out/runbutan-demo.mp4 (1920x1080, 30fps, ~32s)
```

To preview/edit interactively instead of rendering straight to a file:

```bash
npm start              # opens Remotion Studio, a local dev server with a scrubbable timeline
```

## Changing it

- `src/theme.ts` — every color used; change once, applies everywhere.
- `src/Demo.tsx` — the timeline: each scene's start frame and duration (`T` object). Scenes are
  plain React components under `src/scenes/`; each one's animation is timed relative to its own
  start (Remotion's `<Sequence>` re-bases `useCurrentFrame()` to 0 per scene).
- `src/components/SceneLayout.tsx` — the shared headline + phone-frame + caption layout every
  feature scene (not Intro/Outro) uses.
- `public/logo-mark.png` — the same transparent-background logo asset the app itself uses.

No audio/voiceover track — silent by design so it works muted-autoplay on a landing page or social
feed. Add one with Remotion's `<Audio>` component if you want narration.
