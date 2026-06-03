# Onboarding Wizard Design

## Summary

A 5-step guided walkthrough dialog shown on first run, introducing intermediate developers to ai-14all's core concepts (workspaces, worktrees, terminals, code review) before they load a repository. Re-accessible from the Shortcuts Help modal.

## Target User

Intermediate developers — comfortable with git and terminals, but unfamiliar with git worktrees and the app's specific workflow concepts (workspaces vs worktrees vs sessions).

## Trigger & Gating

- **First-run detection:** `localStorage.getItem("ai14all:onboarding-completed")` — if `null`, show wizard.
- **When:** Shown when `startupMode === "ready"` and no repository is loaded.
- **Skip:** "Skip" button sets `"ai14all:onboarding-completed"` to `"true"` and closes the dialog. User sees the existing bare `RepositoryInput`.
- **Completion:** Flag is set when the user submits a repo path on step 5 (before `handleLoadPath` fires).
- **Re-access:** A "Restart Onboarding" button in `ShortcutsHelp` clears the flag and opens the wizard. Only visible when no repo is loaded.

## Wizard Steps

### Step 1: Welcome

- App name "ai-14all" prominently displayed.
- Tagline: "Your multi-worktree development environment."
- Three bullet feature highlights: worktrees, terminals, code review.
- Read-only. CTA is the "Next" button in the footer.

### Step 2: Workspaces & Worktrees

- Inline diagram showing the relationship: Workspace (= a git repository) → Worktrees (= branch checkouts).
- Key message: "One repo, many branches checked out simultaneously."
- Explains that the sidebar lets you switch between worktrees.
- Read-only.

### Step 3: Terminals

- Mini terminal grid illustration (2×1 layout with sample commands).
- Key message: "Each worktree has its own terminal grid — up to 6 shells, flexible layouts, saved presets."
- Read-only.

### Step 4: Code Review

- Tabbed illustration showing Files / Changes / Commits tabs.
- Mini diff viewer mockup (red/green lines).
- Key message: "Built-in diff viewer with inline comments. Review changes without leaving the app."
- Read-only.

### Step 5: Open a Repository

- Brief text: "Point to a git repository to get started."
- Embeds the existing `<RepositoryInput>` component.
- Error display inherited from the existing component.
- Interactive — user types/selects a path and submits.

## Component Architecture

### New files

- `src/features/onboarding/components/OnboardingWizard.tsx` — wizard component.
- `src/features/onboarding/onboarding-wizard.css` — styles.

### Structure

```
<AppDialog open={showOnboarding} onOpenChange={handleClose} size="wide">
  <AppDialog.Body>
    {/* Step content — conditional render by stepIndex */}
    <StepWelcome />        | stepIndex === 0
    <StepWorktrees />      | stepIndex === 1
    <StepTerminals />      | stepIndex === 2
    <StepReview />         | stepIndex === 3
    <StepRepository />     | stepIndex === 4
  </AppDialog.Body>
  <AppDialog.Footer>
    <BackButton />         {/* hidden on step 0 */}
    <StepDots />           {/* 5 dots, active = --accent */}
    <SkipLink />
    <NextButton />         {/* "Done" on step 4, hidden on step 4 if using repo input submit */}
  </AppDialog.Footer>
</AppDialog>
```

Step content is rendered as functions within the component — no separate files needed (each step is ~20 lines of markup).

### Integration

- `App.tsx` renders `<OnboardingWizard>` when `startupMode === "ready"` and `!repository`.
- Props: `onLoadPath` (passed through to `RepositoryInput` on step 5), `onClose` (skip/dismiss).
- `ShortcutsHelp.tsx` gets a "Restart Onboarding" button that clears the localStorage flag and triggers a callback to show the wizard.

## Styling

- **File:** `src/features/onboarding/onboarding-wizard.css`
- **Dialog:** `AppDialog` with `size="wide"`, content area min-height ~380px to prevent layout shift.
- **Step transitions:** Horizontal slide + fade via CSS (`translateX` + `opacity`, 200ms ease). Respects `prefers-reduced-motion` (instant switch).
- **Step dots:** 8px circles, `--accent` for active, `--panel-border` for inactive. Active dot scales 1.25x.
- **Typography:** Step titles use `--font-size-label` (16px). Body uses `--font-size-body` (13px). Concept labels use `.shell-label` uppercase style.
- **Illustrations:** Inline HTML/CSS diagrams using existing CSS variables. No external images or assets.
- **Themes:** Inherits from `data-theme` via CSS variables — works in dark, light, and warm.

## State Management

- `useState<number>` for `stepIndex` (0–4).
- `localStorage` for the `"ai14all:onboarding-completed"` flag.
- No new context providers, reducers, or persistence layers.

## Accessibility

- `AppDialog` already provides Radix UI Dialog accessibility (focus trap, aria-label, Esc to close).
- Step dots are decorative (not interactive) — navigation is via Back/Next buttons.
- Skip and Next buttons are keyboard-accessible.
- Step transition direction announced via `aria-live="polite"` on the content container.

## Scope Boundaries

- **In scope:** 5-step wizard dialog, localStorage gating, re-access from ShortcutsHelp.
- **Out of scope:** Contextual tooltips on first use of specific features, version-gated "What's New" flows, analytics/telemetry on wizard completion.
