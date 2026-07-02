# Onboarding: First-Launch Tour + Passive Coachmarks — Design

**Date:** 2026-07-02
**Status:** Design approved in brainstorming; pending user spec-review gate before planning.
**Scope:** New-user onboarding for the session view. One cohesive design, shipped in two phases (P0 tour, P1 coachmarks).
**Supersedes:** `2026-05-31-onboarding-wizard-design.md`, `2026-06-10-onboarding-flow-design.md`.

## Context

ai-14all is mission control for parallel AI coding agents: session-per-worktree
isolation, real PTY terminals as the source of truth, a rolled-up attention
model in the sidebar, and in-window diff review. For a power user the layout is
self-evident. For a first-time user, the core mental model — workspaces vs.
worktree sessions, how agents get mounted into terminals, what the attention dot
means, where review happens — is not discoverable without guidance.

There is no onboarding, tour, or coachmark system in the shipping app (only
stranded, unmerged branches — see Prior Art). Two reusable foundations already
exist:

- A localStorage dismissal pattern: `src/features/review/logic/use-install-gap-dismissal.ts`
  (key `ai14all.dismissedInstallGap`) — the model for persisting "user has
  dismissed this UI hint" state.
- A Radix popover/tooltip layer added in the P0 UX work
  (`src/features/workspace/components/SidebarTooltip.tsx`) and a
  native-menu → preload → renderer bridge
  (`electron/main/menu.ts` terminal font-size menu,
  `electron/preload/index.ts` `onAdjustTerminalFontSize`,
  `shared/contracts/commands.ts` `events`).

## Goals

- A first-launch guided tour covering the four critical-path concepts a new
  user must understand to use the app at all. "First launch" means the first
  time the session view is mounted (a repository loaded) — not the empty setup
  screen, since every tour anchor lives in the session view (see the
  arm-then-show fire rule).
- Passive, dismissible coachmarks on four secondary surfaces, appearing in
  context rather than as a forced sequence.
- A trigger that reliably excludes existing users — an upgrading power user with
  saved workspaces must never see the tour.
- Re-invocation from the Help menu ("Show welcome tour", "Reset onboarding
  hints") and the `?` shortcuts overlay.
- Full adherence to the terminal/TUI aesthetic (square corners, monospace, flat
  surfaces, Nerd Font glyphs, reserved app-status hue). No generic SaaS
  product-tour styling.

## Non-Goals

- Deep explainers for advanced features (collab workflows / SDD internals).
  These are intentionally out of onboarding scope.
- Reworking empty-workspace repetition (design-critique #7) — tracked
  separately.
- Server-side or telemetry-driven onboarding analytics.
- Any onboarding content authored by, or rendered inside, the embedded agent
  CLIs (that surface is CLI-owned).

## Experience Model — Hybrid

1. **Guided spotlight tour** on first launch: a dimmed backdrop with a cut-out
   over one anchored region at a time, plus a card with a step counter and
   Back / Skip / Next controls. Four steps. Skippable at any point.
2. **Passive coachmarks** for secondary surfaces: anchored, individually
   dismissible popovers that appear in context and persist until dismissed.

The tour suppresses coachmarks until it is completed or skipped, so the two
layers never appear simultaneously.

## Content

### Guided tour — four steps (first launch)

1. **Sessions are isolated** — anchored to the sidebar tree. Each workspace is a
   repo; each session is its own git worktree, fully isolated.
2. **Mount an agent** — anchored to the agent launcher row. Click **+** to start
   Claude / Codex / ezio in the focused terminal; mount two for a collab.
3. **Know who needs you** — anchored to a sidebar session row. The attention
   dot / "needs you" badge surfaces the session waiting on you.
4. **Review without leaving** — anchored to the REVIEW bar. Inspect diffs and
   comment in-window.

### Passive coachmarks — four surfaces

- **Plugins** (anchored to the plugins entry point in `SessionChipBar`, beside
  the usage chip): the built-in, app-powered tools — memory, history, collab —
  that make the agents work better. Set them up here.
- **Telemetry chip**: click for the token/cost breakdown; toggle week/month.
- **Theme + settings footer**: themes and preferences live here.
- **Find everything** (anchored to the "Open command palette" control in
  `SessionChipBar`): ⌘⇧K opens the command palette to run any action; `?` opens
  the shortcuts overlay. This is the "find everything" concept from the
  work-session deep dive.

### Deliberately dropped

- Collab-pill coachmark and terminal-font-size coachmark (font size is already
  discoverable via the menu). Removed to keep the surface tight.

## Architecture & Components

A new `src/features/onboarding/` feature, split by responsibility:

| Unit | Responsibility |
|---|---|
| `logic/onboarding-state.ts` | Pure functions: fire-gating predicate, retro-mark migration, coachmark-dismissal reducer, localStorage read/write. No React. Fully unit-testable. |
| `logic/tour-steps.ts` | The four tour step definitions as data: `{ id, anchorId, title, body, order }`. Plus `CURRENT_TOUR_VERSION`. |
| `components/TourOverlay.tsx` | Dimmed backdrop with a spotlight cut-out over the current step's anchor rect, plus the step card (counter, Back / Skip / Next). |
| `components/Coachmark.tsx` | A single anchored, dismissible popover (Radix Popover), styled flat. |
| `hooks/use-onboarding.ts` | Orchestration: whether the tour should fire, current step index, advance/back/skip, coachmark visibility + dismissal, and subscription to the Help-menu bridge events (replay / reset). |

Anchoring is by stable anchor id: each anchored surface exposes a
`data-tour="<id>"` attribute; the overlay/coachmark measures that element's
bounding rect. This decouples onboarding from each surface's internal markup.
`data-tour` reuses the anchor convention from the prior (stranded) onboarding
work rather than inventing a new attribute — see Prior Art below.

### Menu bridge

Mirror the terminal font-size menu pattern:

- `electron/main/menu.ts`: a Help submenu with "Show welcome tour" (id
  `onboarding-show-tour`) and "Reset onboarding hints" (id
  `onboarding-reset`).
- `electron/preload/index.ts`: `onShowWelcomeTour(handler)` and
  `onResetOnboarding(handler)` over dedicated channels.
- `shared/contracts/commands.ts`: add both to the `events` contract as optional
  handlers (optional to match the existing desktop-client implementation, which
  the hook consumes with optional chaining).

## Data Flow & Persistence

State lives in localStorage (per-profile UI state), following the existing
`use-install-gap-dismissal` pattern — **not** `workspace-state.json`, which is
workspace data.

- `ai14all.onboarding.tourVersionSeen` → number. The tour version the user last
  completed or skipped. Absent means never seen.
- `ai14all.onboarding.dismissedCoachmarks` → string[]. Coachmark ids the user
  has dismissed.

**Fire rule (arm-then-show).** Every tour step is anchored to a session-view
surface (sidebar tree, agent launcher row, session row, REVIEW bar), and none of
those surfaces exist on the first-launch setup screen: a profile with no
repository renders only `RepositoryInput` (`src/app/App.tsx:2133-2143`); the
sidebar, agent launcher, and REVIEW bar mount only once a repository is loaded
(`src/app/App.tsx:2146` onward). Auto-showing the tour the instant a fresh
profile boots would therefore find zero anchors, skip every step, and persist
`tourVersionSeen` — burning the tour before it teaches anything. To prevent
that, firing is a two-stage gate:

1. **Arm** when `tourVersionSeen < CURRENT_TOUR_VERSION`. Arming alone shows no
   UI and writes no persisted state.
2. **Auto-show** only once the session view is mounted (a repository is loaded)
   AND the first required tour anchor is measurable in the DOM. Until both hold,
   the tour stays armed and silent — a fresh user sitting on the setup screen
   never sees it and never burns it.

`tourVersionSeen` is written only when a *shown* tour is completed or skipped,
never while merely armed. Versioning the flag (rather than a boolean) lets a
future redesigned tour re-fire intentionally without resurrecting the old one
for everyone.

**Retro-mark migration:** on the first run of the build that ships this feature,
if `tourVersionSeen` is absent AND the persisted workspace state contains at
least one workspace, set `tourVersionSeen = CURRENT_TOUR_VERSION`. This is what
guarantees an upgrading existing user is silent. A genuinely fresh profile (no
workspaces, no flag) arms the tour; per the arm-then-show rule above it
auto-shows on the first session-view mount (the first repository load), not on
the empty setup screen.

**Replay / reset entry points:**
- **Help menu** — "Show welcome tour" re-runs the tour immediately without
  changing persisted state until the user completes or skips it again; "Reset
  onboarding hints" clears `dismissedCoachmarks` (and, optionally, resets
  `tourVersionSeen`) so all hints return.
- **Shortcuts overlay (`?`)** — the existing `ShortcutsHelp` overlay is a natural
  second home for a "Replay welcome tour" affordance, since a user who opens it
  is already looking for orientation. It dispatches the same replay action as the
  Help menu item.

## Aesthetic (Hard Constraint)

This is the constraint that a prior mockup violated and was rejected for. The
onboarding UI must read as part of a terminal TUI, not a generic desktop/SaaS
app:

- `--radius: 0` (square corners), solid separators, monospace type, flat
  surfaces.
- Nerd Font glyphs via the existing `Icon` component (e.g. `ⓘ` / `info`),
  rendered in the `.app-nf` span.
- The accent uses the reserved app-status hue, never a provider/ANSI hue.
- No rounded bubbles, no drop shadows beyond what the active theme already
  permits, no easing-heavy entrance animations.
- A permanent gallery fixture (`src/app/UiGallery.tsx`) renders both the tour
  step card and a coachmark, so the look is visually reviewable and
  e2e-anchored.

## Prior Art & Superseded Work

Onboarding was attempted twice before and parked. This design builds fresh; the
prior artifacts are referenced for concepts only and are **not** to be ported
(they are stale and bundled with unrelated overhauls):

- `origin/onboarding` branch — a layered contextual system (`GuidedTour.tsx`, a
  4-stop coachmark tour over `data-tour` anchors, `FirstRunHint`,
  `SystemCheckStrip`, `WelcomeScreen`, `use-onboarding-state.ts` localStorage
  latch). Closest match to this coachmark direction; ~532 commits behind master
  and bundled with an unrelated icon migration + dialog work. We keep only the
  `data-tour` anchor convention.
- `UI-overhaul` branch — `OnboardingWizard.tsx`, a 5-step pre-repo dialog tour.
- `docs/superpowers/specs/2026-05-31-onboarding-wizard-design.md` (5-step dialog)
  and `docs/superpowers/specs/2026-06-10-onboarding-flow-design.md` (4-step
  full-screen narrative pitch) — **both superseded by this document.**

This design was previously deferred (memory
`mem-2026-06-29-onboarding-deferred-until-devel-sidebar`) until the `devel`
sidebar redesign merged and the UI stabilized. As of 2026-07-02 that condition
is met: `devel` is fully contained in master, and the sidebar rework (SidebarPanel
extraction, resizable sidebar, Radix tooltips, the non-color attention signal)
has all landed and stabilized on master.

**Reusable infrastructure to build on** (not reinvent): the localStorage gating
pattern (`use-install-gap-dismissal.ts`), the `startupMode` machine in
`use-startup-restore.ts` (natural point to gate the first-launch fire), the
`AppDialog` primitive, the Radix Tooltip/Popover primitives, and the
`ShortcutsHelp` overlay as a replay entry.

## Edge Cases

- **Session view not yet mounted** (fresh profile still on the setup screen, no
  repository loaded): the tour is armed but does not auto-show and does not
  persist `tourVersionSeen` — it waits for the first session-view mount (see the
  arm-then-show fire rule). It must never skip its way to "seen" on the setup
  screen.
- **A single step's anchor absent within a mounted session view** (e.g. the
  REVIEW bar is collapsed): that individual step is skipped gracefully rather
  than wedging on a missing rect; the remaining anchored steps still show.
- **Window resize or workspace switch mid-tour**: anchor rects are re-measured;
  the spotlight and card reposition.
- **Tour vs. coachmarks**: coachmarks are suppressed while the tour is active
  (until completed or skipped).
- **Reduced motion**: honor `prefers-reduced-motion` — no spotlight transition
  animation when set.
- **Rapid Skip**: skipping persists `tourVersionSeen` exactly as completing does,
  so a skipped tour does not re-fire.

## Testing Strategy

- **Unit** (`tests/unit/onboarding/`): the state reducer — the arm-then-show
  fire-gating predicate across flag / workspace / session-view-mounted
  combinations (armed but not shown when the session view is absent; shown only
  when armed AND the session view is mounted), retro-mark migration, coachmark
  dismissal add/idempotency; tour-steps data integrity (unique ids, contiguous
  order).
- **e2e** (`tests/e2e/`): fresh profile on the setup screen (no repository) →
  tour is armed but does NOT show and `tourVersionSeen` stays absent; fresh
  profile after a repository loads and the session view mounts → tour fires;
  `tourVersionSeen` set → silent; retro-mark → existing-workspace profile stays
  silent; Help "Show welcome tour" re-fires; coachmark dismiss persists across a
  reload; a single step whose anchor is absent within a mounted session view is
  skipped, not wedged.
- **Gallery** (`tests/e2e/` against `#/ui-gallery`): tour card and coachmark
  fixtures render with the TUI styling and expected glyph/label.

## Phasing

- **Phase 0 — Guided tour.** `onboarding-state.ts`, `tour-steps.ts`,
  `TourOverlay.tsx`, `use-onboarding.ts`, anchor attributes on the four tour
  surfaces, the Help-menu bridge (show-tour + reset), retro-mark migration,
  arm-then-show fire-gating (armed on a fresh profile, auto-shown only on the
  first session-view mount with a live anchor), unit + e2e + gallery coverage.
- **Phase 1 — Passive coachmarks.** `Coachmark.tsx`, the four coachmark
  definitions + anchors (plugins, telemetry chip, theme/settings footer, command
  palette / find-everything), dismissal persistence, tour-suppression interplay,
  their unit + e2e + gallery coverage.

Phase 0 delivers working, testable software on its own; Phase 1 layers on the
shared foundation without reworking it.
