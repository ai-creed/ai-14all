# Onboarding Flow Design

> Supersedes [2026-05-31-onboarding-wizard-design.md](./2026-05-31-onboarding-wizard-design.md)
> (dialog-based 5-step feature tour, implemented on the unmerged `UI-overhaul` branch).
> This design replaces the feature-tour framing with a narrative pitch in a full-screen
> stepper, while inheriting the proven mechanics from that implementation: the
> `localStorage` completion flag, the ShortcutsHelp restart entry, and embedding
> `RepositoryInput` in the final step.

## Summary

A full-screen 4-step narrative stepper shown once on first launch, before any
repository is loaded. It introduces ai-14all, names the problem (an unmanaged agent
swarm), shows how the app solves it, and ends by loading the user's first repository.
Slogan: **"One for all-mighty agents. Go beyond!"**

## Target User

Engineers who already run AI coding agents (Claude, Codex, other agent CLIs) and are
evaluating whether ai-14all is worth adopting. The flow sells the why before the how —
it is a pitch, not a feature tour.

## Trigger & Gating

- **First-run detection:** `localStorage.getItem("ai14all:onboarding-completed")` —
  if `null`, the app enters a new `startupMode === "onboarding"` before resolving to
  `"prompt"` / `"ready"` in `App.tsx`.
- **Skip:** visible on steps 1–3; sets the flag to `"true"` and continues normal
  startup resolution (restore prompt or bare `RepositoryInput`).
- **Completion:** the flag is set when the user submits a repository path on step 4
  (before `handleLoadPath` fires).
- **Replay:** a "Welcome to ai-14all" button in `ShortcutsHelp` reopens the stepper
  at any time as a replay: steps 1–3 only, with a Close button instead of the
  repository form (the user already has a repo loaded; clearing it would be hostile).

## Steps

### Step 1 — Introduce

- Wordmark "ai-14all" with the slogan: **"One for all-mighty agents. Go beyond!"**
- Supporting line: "Run Claude, Codex, or any agent CLI side by side — each in its
  own isolated Git worktree."
- Read-only. CTA: Next.

### Step 2 — The Problem

- Headline: **"One agent is easy. An agent swarm is chaos."**
- Three pain bullets, framed as what happens when you run a swarm without structure:
  - The swarm clobbers itself — agents overwrite each other's files on a shared
    checkout.
  - You lose track of the swarm — which agent is working, which is stuck waiting
    on you.
  - Reviewing the swarm's output means juggling terminals and an IDE.
- Read-only.

### Step 3 — The Solution

- Three beats mirroring the pains, each with an icon (lucide, matching the app's
  icon set):
  - **Isolation** — every session automatically gets its own Git worktree and
    branch; agents never collide.
  - **Attention** — the sidebar shows who's working, who's blocked on you, who's
    done; agents self-report over the built-in MCP server.
  - **Review in place** — inspect diffs, comment, keep or discard without leaving
    the window.
- Footnote line: live per-agent token telemetry for Claude and Codex.
- Read-only.

### Step 4 — Go Beyond

- Headline: "Go beyond. Load your first repository."
- Embeds the existing `<RepositoryInput>` component (path field, Browse, Load),
  inheriting its error display.
- Interactive — submitting a path sets the completion flag and lands the user in
  the normal app.
- No Skip on this step (the only exits are Back or loading a repo); the Load action
  is the finish.

## Component Architecture

### New files

- `src/features/onboarding/OnboardingStepper.tsx` — the full-screen stepper.

### Structure

```
<main className="shell-app shell-app--setup shell-app--onboarding">
  {/* Step content — conditional render by stepIndex (0–3) */}
  <StepIntroduce />   | stepIndex === 0
  <StepProblem />     | stepIndex === 1
  <StepSolution />    | stepIndex === 2
  <StepGoBeyond />    | stepIndex === 3   (hidden in replay mode)
  <footer>
    <BackButton />    {/* hidden on step 0 */}
    <StepDots />      {/* 4 dots; 3 in replay mode */}
    <SkipLink />      {/* steps 0–2 only; "Close" in replay mode */}
    <NextButton />    {/* hidden on step 3 — RepositoryInput's Load is the finish */}
  </footer>
</main>
```

Step content is rendered as functions within the component — each step is small
markup, no separate files.

### Integration

- `App.tsx`: `startupMode` gains an `"onboarding"` value. The startup handshake in
  `use-startup-restore.ts` checks the completion flag first; when absent it resolves
  to `"onboarding"` instead of `"prompt"`/`"ready"`. Finish/skip transitions to the
  mode the handshake would otherwise have produced.
- Props: `onLoadPath` (passed through to `RepositoryInput` on step 4), `onDone`
  (skip/finish/close), `replay: boolean`.
- `ShortcutsHelp.tsx` gets a "Welcome to ai-14all" button that opens the stepper in
  replay mode (it does not clear the flag).

## Navigation & Input

- Next / Back buttons, dot progress indicator (decorative, not interactive).
- Keyboard: `←`/`→` to navigate, `Enter` advances (except inside the path input on
  step 4), `Esc` skips on steps 1–3 and does nothing on step 4 (closes, in replay
  mode).

## Styling

- Reuses the `shell-app--setup` full-screen treatment; content column centered,
  max-width ~560px.
- Step transitions: horizontal slide + fade (`translateX` + `opacity`, 200ms ease);
  instant switch under `prefers-reduced-motion`.
- Step dots: 8px circles, `--accent` active (1.25x scale), `--panel-border` inactive.
- Theme-aware via existing CSS variables (`data-theme`) — dark, light, and warm.
- Illustrations, if any, are inline HTML/CSS using existing variables — no external
  image assets.

## State Management

- `useState<number>` for `stepIndex`.
- `localStorage` for `"ai14all:onboarding-completed"` (same key as the superseded
  implementation, so users of `UI-overhaul` builds are not re-onboarded).
- No new context providers, reducers, or persistence layers.

## Accessibility

- The stepper is a full-screen `<main>`, not a dialog — no focus trap needed; focus
  moves to the step heading on step change.
- Step changes announced via `aria-live="polite"` on the content container.
- All controls keyboard-accessible; dots are decorative.

## Testing

- **Unit:** startup-mode resolution (flag absent → `"onboarding"`; flag set → normal
  flow), skip/finish set the flag, replay mode hides step 4 and never clears the flag.
- **E2E (Playwright):** fresh profile shows the stepper; completing step 4 loads a
  repository; relaunch with the flag set goes straight to the normal startup flow.
  Existing e2e suites that assume no onboarding must clear/set the flag in setup
  (the `UI-overhaul` branch did the same in its flush-layout suite).

## Scope Boundaries

- **In scope:** 4-step full-screen stepper, localStorage gating, replay from
  ShortcutsHelp, slogan placement.
- **Out of scope:** in-app coach marks or guided tours after a repo loads, animated
  illustrations or video, per-step analytics/telemetry, version-gated "What's New"
  flows, Windows/Intel considerations.
