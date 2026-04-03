# Radix Terminal-First Shell Design

## Purpose

The current UI is functionally useful, but it still looks like a hand-built internal shell rather than a product-ready developer tool.

This design introduces a stronger UI foundation and a more intentional visual direction without turning the app into a generic dashboard or an IDE clone.

The goal is to make the app feel like a modern terminal-centric tool for technical users, where the terminal and session overview are the center of gravity and code viewing remains secondary.

## Problem

The current renderer has two related issues:

- interaction-heavy UI pieces are mostly built from raw elements
- the overall shell styling is too raw and visually flat

That creates a few practical problems:

- tabs, lists, and panels feel inconsistent
- the app lacks a strong visual hierarchy
- branch and session context do not feel product-grade
- the terminal-first product direction is not obvious from the current shell

This is not a content problem. It is a component-foundation and shell-polish problem.

## Product Direction

The UI should feel like a modern terminal tool, not a consumer web app and not a full IDE.

Key product cues:

- terminal work is primary
- session and branch awareness are always visible
- review tools are present but visually secondary
- the shell is dense, crisp, and technical
- styling should feel deliberate without becoming flashy

The chosen visual baseline is the `A1` direction validated during brainstorming:

- carbon and dark-slate surfaces
- restrained teal accents for active and positive states
- strong panel boundaries
- compact spacing
- rounded but not soft chrome

This pass should ship one polished default theme only.

Explicitly deferred:

- theme switching
- multiple palettes
- a generalized theming platform

## Library Decision

Use `Radix Primitives` directly as the interaction foundation.

Do not adopt `MUI`, `Mantine`, or another full visual system for this app.

Do not adopt `shadcn/ui` in this pass.

### Why Radix

`Radix Primitives` fits this product better because it provides accessible, widely adopted interaction mechanics without forcing a consumer-product visual identity.

That lets the app keep its own terminal-tool personality while avoiding fragile hand-rolled behavior for common controls.

### Why Not A Full Component Kit

Full kits such as `MUI` and `Mantine` optimize for speed and breadth, but they come with stronger visual assumptions than this app should adopt.

This product needs a narrower, more technical shell language. A primitive layer is a better fit than a large opinionated design system.

### Why Not shadcn/ui

`shadcn/ui` is a valid approach, but it strongly pulls the stack toward Tailwind-style component composition and a copied-in component model that the repo does not use today.

The app does not need that larger shift to get the UI improvement it needs right now.

## Goals

This design should:

- replace the raw-feeling interaction surfaces with stable primitives
- make the terminal area feel like the primary workspace
- improve visual hierarchy across the session shell
- create a coherent default theme for the app shell
- keep the migration incremental and compatible with the current Phase 2 architecture

## Non-Goals

This design does not try to:

- redesign every screen in the product
- replace Monaco or xterm internals
- add advanced theming support
- introduce broad motion design
- solve every future UI need in one component pass

The goal is a better shell foundation, not a full design-system program.

## Scope

This pass should cover the main Phase 2 shell surfaces:

- session sidebar
- session header
- terminal tab strip
- review mode tabs for `Files` and `Changes`
- file and changes rails
- context panel
- shared panel framing, separators, and scroll regions

Use Radix where interaction behavior matters most:

- `Tabs`
- `ScrollArea`
- `Tooltip`
- `Separator`

Likely later, but not required in the first slice:

- `Dialog`
- `DropdownMenu`

This pass should leave these internals alone:

- Monaco editor internals
- xterm terminal internals

Only their surrounding containers, headers, spacing, and panel chrome should be restyled.

## Visual Language

The default shell should follow the `A1` direction.

### Surface Model

Use a layered shell with clear separation:

- app background darker than panels
- panels slightly lifted by contrast, not heavy shadow
- selected and active states expressed through border, fill, and text contrast

Recommended visual behavior:

- background: near-black carbon tone
- panel surfaces: dark slate
- borders: cool, visible, but not bright
- active accents: restrained teal
- warning or changed-file states: warm amber
- destructive or failure states: muted red

### Density

The shell should feel denser than a standard SaaS dashboard.

This is a desktop developer tool. It should make efficient use of space without feeling cramped.

Guidelines:

- tighter vertical rhythm than the current UI
- smaller but still readable labels
- compact control padding
- more emphasis on structure than decorative spacing

### Typography

Typography should support a technical tool feel.

Recommended approach:

- use a clean UI sans for chrome and labels
- keep Monaco and terminal monospace surfaces as they are
- use uppercase micro-labels sparingly for section anchors such as `Sessions`, `Changes`, and `Context`

This pass does not require a custom font rollout if that complicates packaging. System-safe defaults are acceptable if the hierarchy is improved.

## Component Strategy

### Session Sidebar

The sidebar should feel like a durable navigation rail, not a list of temporary buttons.

Desired behavior:

- scrollable when worktrees exceed available height
- clear selected state
- branch or session metadata visible without visual clutter

Visual treatment:

- darker anchored rail
- selected session uses the accent color sparingly
- inactive sessions stay readable but subdued

### Session Header

The header should anchor the active session without becoming a toolbar wall.

Minimum visual responsibilities:

- identify the active session label
- show branch name clearly
- surface changed-file count in a compact way

It should read as a status strip, not a command center.

### Terminal Tabs

Terminal tabs are one of the highest-value Radix adoption points.

Requirements:

- clear active tab state
- strong fit with the shell chrome
- compact create and close affordances
- support exited or non-running states without ambiguity

The tab strip should feel like part of the terminal workspace, not a browser tab bar.

### Review Tabs

The `Files` and `Changes` switch should also use Radix `Tabs`, but it should be styled more quietly than terminal tabs.

Reason:

- terminal tabs represent active process work
- review tabs represent mode selection

These two tab systems should share primitives but not identical visual weight.

### Scrollable Rails

The sidebar and review lists should use `ScrollArea` so scrolling behavior feels intentional and visually consistent.

That is more important in this app than decorative scroll styling.

### Context Panel

The context panel should become a strong identity block for the active worktree.

Responsibilities:

- branch should be hard to miss
- path should remain visible and scannable
- note field should feel lightweight but integrated

This panel is not a form. It is persistent working context.

## Token And Styling Direction

Use CSS variables for the shell so the styling remains coherent and can support theming later if needed.

But do not overbuild a theme system now.

Recommended first token groups:

- background and surface colors
- border colors
- accent and status colors
- text hierarchy colors
- spacing scale
- radius scale

The token layer should be sufficient to restyle the shell consistently, not a full semantic design token taxonomy.

## Accessibility And Behavior

Radix adoption should improve interaction quality, not only visuals.

The updated shell should preserve or improve:

- keyboard navigation for tabs and focusable controls
- clear focus states
- screen-reader-friendly tab semantics
- visible active and disabled states

This matters especially for:

- terminal tab switching
- review mode switching
- future menus and dialogs

## Migration Strategy

The safest first implementation slice is:

1. add Radix dependencies and shared shell variables
2. restyle the high-level app shell containers
3. migrate terminal tabs to Radix `Tabs`
4. migrate `Files` and `Changes` mode switching to Radix `Tabs`
5. wrap sidebar and list rails with `ScrollArea`
6. tune context panel, header, and separators to the new shell language

This keeps the work incremental and reduces the risk of a broad UI rewrite.

## Testing

This design should be covered at two levels.

### Unit And Component Coverage

Add or update component tests around:

- tab selection behavior
- sidebar rendering and selection states
- context panel note interaction
- review mode switching

### End-To-End Coverage

Existing cumulative e2e coverage should continue to pass after the migration.

Where selectors become more semantic because of Radix adoption, update the tests to use the improved roles rather than brittle text-only or CSS selectors.

The visual polish pass should not degrade the cumulative workflow guarantees already established in the e2e suite.

## Acceptance Criteria

This effort is successful when:

- the app shell no longer looks like raw assembled elements
- terminal work is visually dominant
- session and branch context are easy to identify at a glance
- tabs, rails, and separators feel coherent across the workspace
- the default theme feels like a modern terminal tool
- Phase 2 behavior remains intact while the UI foundation improves

## Deferred Work

Intentionally defer:

- multiple themes
- theme switching UI
- deeper Monaco theming work
- deeper xterm theming work
- broader component-library expansion beyond the key shell primitives
- animation polish
- a generalized cross-product design system

That keeps this effort focused on one product-ready default shell rather than a larger UI platform investment.
